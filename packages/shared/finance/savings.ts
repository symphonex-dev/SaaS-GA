import type { Currency } from '../constants/currencies';
import { clampPercentage, percentageOf } from './percentage';
import { zeroMoney, type Money } from './money';

/**
 * Économies (`specs/calculs-financiers.md` §6).
 *
 * Une économie **potentielle** est une proposition du moteur ; elle ne devient
 * jamais **confirmée** automatiquement — seule une action de l'utilisateur peut
 * la valider. Les deux montants restent donc toujours distincts.
 */
export const SAVING_STATUSES = ['POTENTIAL', 'CONFIRMED', 'DISMISSED'] as const;
export type SavingStatus = (typeof SAVING_STATUSES)[number];

export interface Saving {
  id: string;
  sourceExpenseId: string | null;
  sourceOfferId: string | null;
  potentialAmount: Money;
  confirmedAmount: Money;
  status: SavingStatus;
}

/**
 * Économie potentielle entre le coût annuel actuel et une alternative.
 *
 * Une alternative plus chère ne produit jamais une « économie négative » :
 * le résultat est ramené à zéro (§6).
 */
export function calculatePotentialSavings(
  currentAnnualMinor: bigint,
  alternativeAnnualMinor: bigint,
): bigint {
  return currentAnnualMinor > alternativeAnnualMinor
    ? currentAnnualMinor - alternativeAnnualMinor
    : 0n;
}

/** Variante `Money` : les deux montants doivent partager la même devise (§7). */
export function potentialSavingsBetween(current: Money, alternative: Money): Money | null {
  if (current.currency !== alternative.currency) {
    return null;
  }

  return {
    amountMinor: calculatePotentialSavings(current.amountMinor, alternative.amountMinor),
    currency: current.currency,
  };
}

export interface SavingsSummary {
  potential: Money;
  confirmed: Money;
}

/**
 * Agrège une liste d'économies en distinguant strictement le potentiel du
 * confirmé. Une économie `DISMISSED` ne compte dans aucun des deux.
 */
export function summarizeSavings(savings: readonly Saving[], currency: Currency): SavingsSummary {
  let potential = 0n;
  let confirmed = 0n;

  for (const saving of savings) {
    if (saving.status === 'POTENTIAL' && saving.potentialAmount.currency === currency) {
      potential += saving.potentialAmount.amountMinor;
      continue;
    }

    if (saving.status === 'CONFIRMED' && saving.confirmedAmount.currency === currency) {
      confirmed += saving.confirmedAmount.amountMinor;
    }
  }

  return {
    potential: { amountMinor: potential, currency },
    confirmed: { amountMinor: confirmed, currency },
  };
}

export interface GoalProgress {
  target: Money | null;
  achieved: Money | null;
  /** Progression bornée `[0, 100]`, `null` si l'objectif est nul ou absent (§8). */
  progressPercentage: string | null;
}

/**
 * Progression d'un objectif d'épargne.
 *
 * Un objectif à zéro ne provoque aucune division par zéro : la progression
 * vaut `null` (§9).
 */
export function computeGoalProgress(target: Money | null, achieved: Money | null): GoalProgress {
  if (target === null) {
    return { target: null, achieved, progressPercentage: null };
  }

  const reached = achieved ?? zeroMoney(target.currency);

  if (reached.currency !== target.currency) {
    return { target, achieved, progressPercentage: null };
  }

  return {
    target,
    achieved: reached,
    progressPercentage: clampPercentage(percentageOf(reached.amountMinor, target.amountMinor)),
  };
}
