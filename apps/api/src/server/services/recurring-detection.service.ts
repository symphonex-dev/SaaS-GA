import {
  ERROR_CODES,
  isSupportedCurrency,
  type AuthenticatedUser,
  type DetectionStatus,
  type ExpenseFrequency,
  type ModifyRecurringDetectionInput,
  type RecurringDetectionDto,
} from '@subscription-manager/shared';
import type { Expense } from '@prisma/client';

import { AppError } from '@/lib/api/errors';
import { decimalStringToMinorUnits } from '@/lib/finance/money';
import {
  detectRecurrence,
  type RecurringDetectionInput,
  type RecurringDetectionResult,
} from '@/lib/recurring/detect';
import { effectiveMerchant, recurringMerchantKey } from '@/lib/recurring/normalize';
import {
  recurringRepository,
  type DetectionWithExpense,
} from '@/server/repositories/recurring.repository';

/**
 * Service de détection des récurrences (`specs/moteur-recurrence.md`).
 *
 * Le service ne calcule rien : il charge les données de l'utilisateur, les
 * regroupe par commerçant, délègue au moteur pur `detectRecurrence`, puis
 * persiste le résultat. Toute la logique d'analyse reste testable sans base.
 */

/**
 * Éligibilité d'une dépense à l'analyse (`specs/moteur-recurrence.md` §2).
 *
 * Sont exclus :
 *  - les transactions `CANCELLED` (et `TO_REVIEW`, non encore validées), qui
 *    ne doivent pas déclencher de nouvelle récurrence active ;
 *  - les remboursements : le pipeline d'import les marque `REFUND` et ne les
 *    insère jamais comme dépense (`specs/import-releves.md` §6). Le filtre sur
 *    un montant strictement positif garantit qu'aucun mouvement de sens inverse
 *    ne puisse alimenter l'historique, quelle que soit son origine.
 */
export function isEligibleForRecurrence(expense: Expense): boolean {
  const amount = expense.amount.toString();

  // Montant strictement positif : ni signe négatif, ni valeur nulle. Le test
  // reste textuel pour ne jamais convertir un montant en flottant.
  return expense.status === 'ACTIVE' && !amount.startsWith('-') && /[1-9]/.test(amount);
}

/** Un groupe de dépenses partageant le même commerçant et la même devise. */
export interface MerchantGroup {
  key: string;
  merchant: string;
  currency: string;
  expenses: Expense[];
}

/**
 * Regroupe les dépenses éligibles par commerçant **et par devise** : deux
 * paiements du même commerçant dans deux devises différentes ne forment pas une
 * même série (leurs montants ne sont pas comparables).
 */
export function groupByMerchant(expenses: readonly Expense[]): MerchantGroup[] {
  const groups = new Map<string, MerchantGroup>();

  for (const expense of expenses) {
    if (!isEligibleForRecurrence(expense)) {
      continue;
    }

    const merchant = effectiveMerchant(expense);
    const key = `${recurringMerchantKey(expense)}|${expense.currency}`;
    const existing = groups.get(key);

    if (existing === undefined) {
      groups.set(key, { key, merchant, currency: expense.currency, expenses: [expense] });
      continue;
    }

    existing.expenses.push(expense);
  }

  // Ordre de sortie stable : le résultat ne dépend pas de l'ordre d'insertion.
  return [...groups.values()].sort((left, right) => (left.key < right.key ? -1 : 1));
}

/** Construit l'entrée du moteur pur à partir d'un groupe de dépenses. */
export function toDetectionInput(group: MerchantGroup): RecurringDetectionInput {
  return {
    merchantNormalized: group.merchant,
    currency: group.currency,
    transactions: group.expenses.map((expense) => ({
      id: expense.id,
      date: expense.date.toISOString().slice(0, 10),
      amount: expense.amount.toString(),
    })),
  };
}

/** Dépense servant d'ancre à la détection : la plus récente du groupe. */
function anchorExpense(group: MerchantGroup): Expense | undefined {
  return [...group.expenses].sort((left, right) => right.date.getTime() - left.date.getTime())[0];
}

/**
 * `RecurringDetection` ne porte pas de devise : celle de la série est celle de
 * la dépense d'ancrage, incluse par le repository.
 */
function toDto(detection: DetectionWithExpense): RecurringDetectionDto {
  const currency = isSupportedCurrency(detection.expense.currency)
    ? detection.expense.currency
    : 'EUR';
  const minorUnits = decimalStringToMinorUnits(detection.amountVariance.toString(), currency);

  return {
    id: detection.id,
    expenseId: detection.expenseId,
    frequency: detection.frequency,
    confidenceScore: detection.confidenceScore,
    status: detection.status,
    intervalDays: detection.intervalDays,
    amountVariance: {
      minorUnits: (minorUnits ?? 0n).toString(),
      currency,
    },
    createdAt: detection.createdAt.toISOString(),
    updatedAt: detection.updatedAt.toISOString(),
  };
}

async function setStatus(
  user: AuthenticatedUser,
  detectionId: string,
  status: DetectionStatus,
  frequency?: ExpenseFrequency,
): Promise<RecurringDetectionDto> {
  const detection = await recurringRepository.findForUser(detectionId, user.id);

  if (detection === null) {
    // Une détection d'un autre utilisateur est traitée comme inexistante.
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Détection introuvable.', 'id');
  }

  await recurringRepository.update(detectionId, user.id, {
    status,
    ...(frequency === undefined ? {} : { frequency }),
  });

  const updated = await recurringRepository.findForUser(detectionId, user.id);

  return toDto(
    updated ?? { ...detection, status, ...(frequency === undefined ? {} : { frequency }) },
  );
}

export interface RefreshSummary {
  created: number;
  updated: number;
  /** Groupes analysés mais non retenus comme récurrents. */
  ignored: number;
}

export const recurringDetectionService = {
  /**
   * Rejoue la détection sur l'ensemble des dépenses éligibles de l'utilisateur.
   *
   * Les arbitrages de l'utilisateur sont préservés :
   *  - une détection `REJECTED` n'est jamais recréée ni réactivée ;
   *  - une détection `MODIFIED` conserve la fréquence choisie par
   *    l'utilisateur ; seules les métriques observées sont rafraîchies.
   *
   * Note sur le statut initial : `DetectionStatus` ne comporte pas d'état
   * « proposé » (`specs/schema-donnees.md` §6 fixe l'enum à CONFIRMED /
   * MODIFIED / REJECTED). Une nouvelle détection est donc écrite `CONFIRMED`,
   * et reste rejetable à tout moment par l'utilisateur (§8).
   */
  async refreshForUser(userId: string): Promise<RefreshSummary> {
    const [expenses, existing] = await Promise.all([
      recurringRepository.listActiveExpenses(userId),
      recurringRepository.listForUser(userId),
    ]);

    const existingByKey = new Map<string, DetectionWithExpense>();

    for (const detection of existing) {
      existingByKey.set(
        `${recurringMerchantKey(detection.expense)}|${detection.expense.currency}`,
        detection,
      );
    }

    const summary: RefreshSummary = { created: 0, updated: 0, ignored: 0 };

    for (const group of groupByMerchant(expenses)) {
      const result = detectRecurrence(toDetectionInput(group));
      const previous = existingByKey.get(group.key);

      if (!result.isRecurring || result.frequency === null || result.confidence === null) {
        summary.ignored += 1;
        continue;
      }

      // L'utilisateur a rejeté cette récurrence : elle n'est jamais ressuscitée.
      if (previous?.status === 'REJECTED') {
        summary.ignored += 1;
        continue;
      }

      const anchor = anchorExpense(group);

      if (anchor === undefined) {
        summary.ignored += 1;
        continue;
      }

      const data = {
        expenseId: anchor.id,
        // Une fréquence corrigée par l'utilisateur fait autorité sur le moteur.
        frequency: previous?.status === 'MODIFIED' ? previous.frequency : result.frequency,
        confidenceScore: result.confidence,
        intervalDays: result.intervalDays ?? 0,
        amountVariance: result.amountVariance,
      };

      if (previous === undefined) {
        await recurringRepository.create(userId, { ...data, status: 'CONFIRMED' });
        summary.created += 1;
        continue;
      }

      await recurringRepository.update(previous.id, userId, { ...data, updatedAt: new Date() });
      summary.updated += 1;
    }

    return summary;
  },

  /** Analyse pure d'un groupe, exposée pour l'aperçu et les tests. */
  analyze(group: MerchantGroup): RecurringDetectionResult {
    return detectRecurrence(toDetectionInput(group));
  },

  async confirm(user: AuthenticatedUser, detectionId: string): Promise<RecurringDetectionDto> {
    return setStatus(user, detectionId, 'CONFIRMED');
  },

  async modify(
    user: AuthenticatedUser,
    detectionId: string,
    input: ModifyRecurringDetectionInput,
  ): Promise<RecurringDetectionDto> {
    return setStatus(user, detectionId, 'MODIFIED', input.frequency);
  },

  async reject(user: AuthenticatedUser, detectionId: string): Promise<RecurringDetectionDto> {
    return setStatus(user, detectionId, 'REJECTED');
  },
};
