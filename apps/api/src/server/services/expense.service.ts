import {
  ERROR_CODES,
  type AuthenticatedUser,
  type CreateExpenseInput,
  type ExpenseDto,
  type UpdateExpenseInput,
} from '@subscription-manager/shared';
import type { Expense, Prisma } from '@prisma/client';

import { AppError } from '@/lib/api/errors';
import { resolveCurrency } from '@/lib/finance/currency';
import { decimalToMoney, minorUnitsToDatabaseDecimal, moneyToDto } from '@/lib/finance/money';
import { getEffectiveMerchantName, normalizeMerchant } from '@/lib/merchant/normalize';
import { expenseRepository } from '@/server/repositories/expense.repository';
import { recurringDetectionService } from '@/server/services/recurring-detection.service';

/**
 * Saisie manuelle et correction de transactions
 * (`specs/ui-composants-mobile.md` §10, CLAUDE.md §5.4).
 *
 * Fonction **secondaire** : elle sert à corriger une ligne importée, à ajouter
 * une dépense en espèces ou une transaction absente du relevé. Elle n'est
 * jamais présentée comme le parcours principal — celui-ci reste l'import de
 * relevé.
 *
 * Toutes les opérations portent sur l'utilisateur de la session ; aucun
 * `userId` fourni par le client n'est accepté (CLAUDE.md §5.3).
 */
export function toExpenseDto(expense: Expense): ExpenseDto | null {
  const amount = decimalToMoney(expense.amount, resolveCurrency(expense.currency));

  if (amount === null) {
    return null;
  }

  return {
    id: expense.id,
    merchantRaw: expense.merchantRaw,
    merchantNormalized: expense.merchantNormalized,
    merchantOverride: expense.merchantOverride,
    // Résolu côté serveur : le mobile n'applique aucune règle métier (§9 import).
    merchantDisplay: getEffectiveMerchantName(expense),
    amount: moneyToDto(amount),
    date: expense.date.toISOString(),
    frequency: expense.frequency,
    category: expense.category,
    paymentMethod: expense.paymentMethod,
    notes: expense.notes,
    status: expense.status,
    source: expense.source === 'MANUAL' ? 'MANUAL' : 'IMPORT',
    importBatchId: expense.importBatchId,
    createdAt: expense.createdAt.toISOString(),
  };
}

function notFound(): AppError {
  return new AppError(ERROR_CODES.NOT_FOUND, 'Transaction introuvable.', 'id');
}

/**
 * Le montant traverse la frontière en unités mineures entières puis repart en
 * décimale exacte pour `Decimal(19, 4)` : à aucun moment il n'est un flottant
 * (CLAUDE.md §5.2).
 */
function amountToDatabase(amount: { minorUnits: string; currency: string }): string {
  return minorUnitsToDatabaseDecimal(BigInt(amount.minorUnits), resolveCurrency(amount.currency));
}

/**
 * Rejoue la détection de récurrence après une écriture manuelle.
 *
 * Au mieux : un échec du moteur est journalisé (nom de l'erreur seul) et ne
 * fait jamais échouer une correction déjà enregistrée — même politique qu'après
 * une confirmation d'import (CLAUDE.md §10.4).
 */
async function refreshDetections(userId: string): Promise<void> {
  try {
    await recurringDetectionService.refreshForUser(userId);
  } catch (error) {
    console.warn(
      `Détection de récurrence en échec après une écriture manuelle : ${
        error instanceof Error ? error.name : typeof error
      }`,
    );
  }
}

export const expenseService = {
  async get(user: AuthenticatedUser, id: string): Promise<ExpenseDto> {
    const expense = await expenseRepository.findForUser(id, user.id);
    const dto = expense === null ? null : toExpenseDto(expense);

    if (dto === null) {
      throw notFound();
    }

    return dto;
  },

  /**
   * Ajoute une transaction absente du relevé (espèces, oubli bancaire).
   *
   * La normalisation du commerçant est celle du pipeline d'import : une ligne
   * saisie à la main et une ligne importée doivent se regrouper de la même
   * façon dans le moteur de récurrence.
   */
  async create(user: AuthenticatedUser, input: CreateExpenseInput): Promise<ExpenseDto> {
    const normalized = normalizeMerchant(input.merchantRaw);

    const created = await expenseRepository.create(user.id, {
      merchantRaw: input.merchantRaw,
      merchantNormalized: normalized.normalized,
      merchantOverride: input.merchantOverride ?? null,
      amount: amountToDatabase(input.amount),
      currency: input.amount.currency,
      date: new Date(input.date),
      frequency: input.frequency,
      category: input.category,
      paymentMethod: input.paymentMethod ?? null,
      notes: input.notes ?? null,
      status: input.status,
      // Une écriture par cette route est manuelle par construction : le client
      // ne peut pas la faire passer pour une ligne importée.
      source: 'MANUAL',
      importBatchId: null,
    });

    await refreshDetections(user.id);

    const dto = toExpenseDto(created);

    if (dto === null) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Transaction illisible après écriture.');
    }

    return dto;
  },

  /**
   * Corrige une transaction (montant, date, catégorie, libellé, statut).
   *
   * `merchantRaw` et `merchantNormalized` ne sont jamais réécrits : la valeur
   * d'origine du relevé est conservée, et la correction de l'utilisateur vit
   * dans `merchantOverride`, qui prime à l'affichage comme au regroupement.
   */
  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateExpenseInput,
  ): Promise<ExpenseDto> {
    const existing = await expenseRepository.findForUser(id, user.id);

    if (existing === null) {
      throw notFound();
    }

    const data: Prisma.ExpenseUpdateInput = {
      ...(input.merchantOverride === undefined
        ? {}
        : { merchantOverride: input.merchantOverride ?? null }),
      ...(input.amount === undefined
        ? {}
        : { amount: amountToDatabase(input.amount), currency: input.amount.currency }),
      ...(input.date === undefined ? {} : { date: new Date(input.date) }),
      ...(input.frequency === undefined ? {} : { frequency: input.frequency }),
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.paymentMethod === undefined ? {} : { paymentMethod: input.paymentMethod ?? null }),
      ...(input.notes === undefined ? {} : { notes: input.notes ?? null }),
      ...(input.status === undefined ? {} : { status: input.status }),
    };

    const updated = await expenseRepository.update(id, user.id, data);

    if (updated === 0) {
      throw notFound();
    }

    // Le montant, la date ou le statut viennent peut-être de changer : les
    // récurrences déjà détectées doivent être recalculées.
    await refreshDetections(user.id);

    return expenseService.get(user, id);
  },

  /**
   * Supprime une transaction saisie ou importée par erreur.
   *
   * Les détections qui s'appuyaient sur elle sont supprimées d'abord : une
   * détection orpheline afficherait un abonnement rattaché à une dépense qui
   * n'existe plus.
   */
  async remove(user: AuthenticatedUser, id: string): Promise<{ deleted: true }> {
    const existing = await expenseRepository.findForUser(id, user.id);

    if (existing === null) {
      throw notFound();
    }

    await expenseRepository.deleteDetectionsForExpense(id, user.id);

    const deleted = await expenseRepository.delete(id, user.id);

    if (deleted === 0) {
      throw notFound();
    }

    await refreshDetections(user.id);

    return { deleted: true };
  },
};
