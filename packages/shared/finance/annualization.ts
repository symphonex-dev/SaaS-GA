import type { ExpenseFrequency } from '../constants/enums';
import { divideMoneyByInteger, multiplyMoneyByInteger, divideRounded, type Money } from './money';

/**
 * Annualisation et moyennes (`specs/calculs-financiers.md` §4).
 *
 * Les facteurs sont des `bigint` : l'annualisation est une multiplication
 * exacte, jamais une approximation flottante.
 */
export const ANNUALIZATION_FACTORS = {
  WEEKLY: 52n,
  MONTHLY: 12n,
  QUARTERLY: 4n,
  YEARLY: 1n,
} as const;

export type AnnualizableFrequency = keyof typeof ANNUALIZATION_FACTORS;

export function isAnnualizable(frequency: ExpenseFrequency): frequency is AnnualizableFrequency {
  return frequency in ANNUALIZATION_FACTORS;
}

/**
 * Coût annuel d'une occurrence récurrente.
 *
 * `ONCE` et `IRREGULAR_RECURRING` ne sont pas annualisables par un facteur
 * fixe : ils renvoient `null` plutôt qu'une fausse précision. Pour
 * `IRREGULAR_RECURRING`, voir `annualizeIrregular`.
 */
export function annualizeRecurring(amount: Money, frequency: ExpenseFrequency): Money | null {
  if (!isAnnualizable(frequency)) {
    return null;
  }

  return multiplyMoneyByInteger(amount, ANNUALIZATION_FACTORS[frequency]);
}

/** Jours d'historique minimum avant d'oser extrapoler une série irrégulière. */
export const IRREGULAR_MINIMUM_HISTORY_DAYS = 90;

/** Occurrences minimum avant d'oser extrapoler une série irrégulière. */
export const IRREGULAR_MINIMUM_OCCURRENCES = 4;

const DAYS_PER_YEAR = 365n;

/**
 * Annualisation d'une série irrégulière : `somme(historique) / joursÉcoulés × 365`.
 *
 * Renvoie `null` si l'historique est trop court ou trop clairsemé — une
 * extrapolation sur deux paiements en trois semaines n'aurait aucune valeur
 * (§4 : « sinon annualized = null, jamais une fausse précision »).
 */
export function annualizeIrregular(
  total: Money,
  elapsedDays: number,
  occurrences: number,
): Money | null {
  if (
    elapsedDays < IRREGULAR_MINIMUM_HISTORY_DAYS ||
    occurrences < IRREGULAR_MINIMUM_OCCURRENCES ||
    elapsedDays <= 0
  ) {
    return null;
  }

  const amountMinor = divideRounded(total.amountMinor * DAYS_PER_YEAR, BigInt(elapsedDays));

  return amountMinor === null ? null : { amountMinor, currency: total.currency };
}

/** `coût annuel récurrent / 12` (§4). */
export function monthlyFromAnnual(annual: Money): Money | null {
  return divideMoneyByInteger(annual, 12n);
}

/**
 * Coût moyen d'une série : `somme / nombre`.
 * `null` si la série est vide — jamais zéro, qui signifierait « gratuit » (§4).
 */
export function averageMoney(values: readonly Money[]): Money | null {
  const first = values[0];

  if (first === undefined) {
    return null;
  }

  let total = 0n;

  for (const value of values) {
    if (value.currency !== first.currency) {
      // Une moyenne multi-devises n'a pas de sens sans conversion tracée (§7).
      return null;
    }

    total += value.amountMinor;
  }

  const amountMinor = divideRounded(total, BigInt(values.length));

  return amountMinor === null ? null : { amountMinor, currency: first.currency };
}
