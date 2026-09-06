import {
  ERROR_CODES,
  type AuthenticatedUser,
  type CreateSavingsGoalInput,
  type UpdateSavingsGoalInput,
  type UserSavingsGoalDto,
} from '@subscription-manager/shared';
import type { Prisma, UserSavingsGoal } from '@prisma/client';

import { AppError } from '@/lib/api/errors';
import { resolveCurrency } from '@/lib/finance/currency';
import { decimalToMoney, minorUnitsToDatabaseDecimal, moneyToDto } from '@/lib/finance/money';
import { entitlementsFor } from '@/server/entitlements/entitlements';
import { dashboardRepository } from '@/server/repositories/dashboard.repository';
import { savingsRepository } from '@/server/repositories/savings.repository';
import { subscriptionRepository } from '@/server/repositories/subscription.repository';

/**
 * Objectifs d'épargne (`specs/ui-composants-mobile.md` §8,
 * `specs/calculs-financiers.md` §6).
 *
 * Règle produit tenue ici : une économie ne devient **confirmée** que lorsque
 * l'utilisateur la valide explicitement. Rien n'est jamais confirmé
 * automatiquement par le moteur — le potentiel et le confirmé restent deux
 * grandeurs distinctes.
 *
 * Le nombre d'objectifs est plafonné par l'offre (`savingsGoalsLimit`,
 * `specs/paiement-in-app.md` §2), contrôle exclusivement serveur.
 */
export function toSavingsGoalDto(goal: UserSavingsGoal): UserSavingsGoalDto | null {
  const currency = resolveCurrency(goal.currency);
  const targetAmount = decimalToMoney(goal.targetAmount, currency);
  const achievedAmount = decimalToMoney(goal.achievedAmount, currency);

  if (targetAmount === null || achievedAmount === null) {
    return null;
  }

  return {
    id: goal.id,
    targetAmount: moneyToDto(targetAmount),
    achievedAmount: moneyToDto(achievedAmount),
    status: goal.status,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

function notFound(): AppError {
  return new AppError(ERROR_CODES.NOT_FOUND, 'Objectif introuvable.', 'id');
}

function toDatabaseAmount(amount: { minorUnits: string; currency: string }): string {
  return minorUnitsToDatabaseDecimal(BigInt(amount.minorUnits), resolveCurrency(amount.currency));
}

/**
 * Statut dérivé du montant atteint.
 *
 * Un objectif atteint bascule en `REACHED` ; s'il est ramené en dessous de sa
 * cible, il redevient `ACTIVE`. Un objectif `ABANDONED` n'est jamais réactivé
 * automatiquement : seule une action explicite peut le rouvrir.
 */
function statusFor(
  current: UserSavingsGoal['status'],
  targetMinor: bigint,
  achievedMinor: bigint,
  requested?: UserSavingsGoal['status'],
): UserSavingsGoal['status'] {
  if (requested !== undefined) {
    return requested;
  }

  if (current === 'ABANDONED') {
    return current;
  }

  return achievedMinor >= targetMinor ? 'REACHED' : 'ACTIVE';
}

export const savingsService = {
  async list(user: AuthenticatedUser): Promise<UserSavingsGoalDto[]> {
    const rows = await dashboardRepository.listSavingsGoals(user.id);

    return rows.flatMap((goal) => {
      const dto = toSavingsGoalDto(goal);

      return dto === null ? [] : [dto];
    });
  },

  /**
   * Crée un objectif, dans la limite de l'offre.
   *
   * La devise de l'objectif est celle du compte : un objectif exprimé dans une
   * autre devise ne serait comparable à aucun total, faute de taux de change
   * (`specs/calculs-financiers.md` §7).
   */
  async create(
    user: AuthenticatedUser,
    input: CreateSavingsGoalInput,
    now: Date = new Date(),
  ): Promise<UserSavingsGoalDto> {
    const subscription = await subscriptionRepository.findByUserId(user.id);
    const limit = entitlementsFor(subscription, now).savingsGoalsLimit;

    if (limit !== null) {
      const existing = await savingsRepository.countForUser(user.id);

      if (existing >= limit) {
        throw new AppError(
          ERROR_CODES.IMPORT_QUOTA_REACHED,
          "Nombre d'objectifs d'épargne atteint pour cette offre.",
        );
      }
    }

    if (input.targetAmount.currency !== user.currency) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        "L'objectif doit être exprimé dans la devise du compte.",
        'targetAmount.currency',
      );
    }

    const created = await savingsRepository.create(user.id, {
      targetAmount: toDatabaseAmount(input.targetAmount),
      currency: input.targetAmount.currency,
      // Un objectif naît toujours à zéro : rien n'est confirmé sans action
      // explicite de l'utilisateur (§6).
      achievedAmount: minorUnitsToDatabaseDecimal(0n, resolveCurrency(input.targetAmount.currency)),
      status: 'ACTIVE',
    });

    const dto = toSavingsGoalDto(created);

    if (dto === null) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Objectif illisible après écriture.');
    }

    return dto;
  },

  /**
   * Met à jour un objectif : cible, montant atteint, ou abandon.
   *
   * C'est ici que passe la **confirmation** d'une économie : l'utilisateur
   * déclare avoir réellement réalisé le montant. Aucun autre chemin n'incrémente
   * `achievedAmount`.
   */
  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateSavingsGoalInput,
  ): Promise<UserSavingsGoalDto> {
    const existing = await savingsRepository.findForUser(id, user.id);

    if (existing === null) {
      throw notFound();
    }

    const currency = resolveCurrency(existing.currency);
    const providedCurrency = input.targetAmount?.currency ?? input.achievedAmount?.currency;

    if (providedCurrency !== undefined && providedCurrency !== currency) {
      // Changer la devise d'un objectif reviendrait à en créer un autre.
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Devise inchangeable.', 'currency');
    }

    const currentTarget = decimalToMoney(existing.targetAmount, currency);
    const currentAchieved = decimalToMoney(existing.achievedAmount, currency);

    if (currentTarget === null || currentAchieved === null) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 'Objectif illisible.');
    }

    const targetMinor =
      input.targetAmount === undefined
        ? currentTarget.amountMinor
        : BigInt(input.targetAmount.minorUnits);
    const achievedMinor =
      input.achievedAmount === undefined
        ? currentAchieved.amountMinor
        : BigInt(input.achievedAmount.minorUnits);

    // L'invariant `achieved <= target` porte sur les deux champs : le schéma ne
    // peut le vérifier que si les deux sont fournis, il est donc revalidé ici
    // sur l'objectif fusionné.
    if (achievedMinor > targetMinor) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'Le montant atteint dépasse la cible.',
        'achievedAmount',
      );
    }

    const data: Prisma.UserSavingsGoalUpdateInput = {
      targetAmount: minorUnitsToDatabaseDecimal(targetMinor, currency),
      achievedAmount: minorUnitsToDatabaseDecimal(achievedMinor, currency),
      status: statusFor(existing.status, targetMinor, achievedMinor, input.status),
      updatedAt: new Date(),
    };

    const updated = await savingsRepository.update(id, user.id, data);

    if (updated === 0) {
      throw notFound();
    }

    const refreshed = await savingsRepository.findForUser(id, user.id);
    const dto = refreshed === null ? null : toSavingsGoalDto(refreshed);

    if (dto === null) {
      throw notFound();
    }

    return dto;
  },

  async remove(user: AuthenticatedUser, id: string): Promise<{ deleted: true }> {
    const deleted = await savingsRepository.delete(id, user.id);

    if (deleted === 0) {
      throw notFound();
    }

    return { deleted: true };
  },
};
