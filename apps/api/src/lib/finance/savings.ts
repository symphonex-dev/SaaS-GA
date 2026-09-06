import {
  computeGoalProgress,
  potentialSavingsBetween,
  summarizeSavings,
  zeroMoney,
  type Currency,
  type GoalProgress,
  type Money,
  type Saving,
  type SavingsSummary,
} from '@subscription-manager/shared';

/**
 * Économies (`specs/calculs-financiers.md` §6 et §8).
 *
 * Potentiel et confirmé restent **toujours distincts** : rien ne fait passer
 * une économie détectée à l'état confirmé sans action de l'utilisateur.
 */
export { calculatePotentialSavings } from '@subscription-manager/shared';

/**
 * Économie annuelle potentielle entre un abonnement et une offre alternative.
 * Une alternative plus chère renvoie zéro, jamais une économie négative.
 */
export function annualSavingAgainstOffer(currentAnnual: Money, offerAnnual: Money): Money | null {
  return potentialSavingsBetween(currentAnnual, offerAnnual);
}

/** Agrège des économies en distinguant potentiel et confirmé. */
export function aggregateSavings(savings: readonly Saving[], currency: Currency): SavingsSummary {
  return summarizeSavings(savings, currency);
}

export interface GoalInput {
  targetAmount: Money;
  achievedAmount: Money;
}

/**
 * Progression de l'objectif d'épargne principal.
 *
 * Un objectif à zéro ne provoque aucune division par zéro : la progression
 * vaut `null` (§9).
 */
export function goalProgress(goal: GoalInput | null): GoalProgress {
  if (goal === null) {
    return { target: null, achieved: null, progressPercentage: null };
  }

  return computeGoalProgress(goal.targetAmount, goal.achievedAmount);
}

/** Total confirmé déclaré par l'utilisateur sur ses objectifs d'épargne. */
export function confirmedFromGoals(goals: readonly GoalInput[], currency: Currency): Money {
  let total = 0n;

  for (const goal of goals) {
    if (goal.achievedAmount.currency === currency) {
      total += goal.achievedAmount.amountMinor;
    }
  }

  return total === 0n ? zeroMoney(currency) : { amountMinor: total, currency };
}
