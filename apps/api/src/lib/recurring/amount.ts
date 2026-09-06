import type { Currency } from '@subscription-manager/shared';

import { decimalStringToMinorUnits, minorUnitsToDecimalString } from '@/lib/finance/money';

/**
 * Variation des montants et hausses de prix
 * (`specs/moteur-recurrence.md` §5).
 *
 * Tous les calculs se font en unités mineures entières (`bigint`) : aucun
 * `number` flottant n'intervient dans une valeur monétaire (CLAUDE.md §5.2).
 * Les comparaisons de proportions sont faites par produit en croix, ce qui
 * évite toute division — donc tout arrondi non maîtrisé.
 */
export interface AmountStatistics {
  /** Montants en unités mineures, dans l'ordre chronologique des occurrences. */
  amounts: bigint[];
  minimum: bigint;
  maximum: bigint;
  /** `max - min`, exact. */
  variance: bigint;
  total: bigint;
  count: number;
}

/** Montant non exploitable : le moteur ignore l'occurrence plutôt que d'arrondir. */
export function parseAmounts(amounts: readonly string[], currency: Currency): bigint[] | null {
  const parsed: bigint[] = [];

  for (const amount of amounts) {
    const minorUnits = decimalStringToMinorUnits(amount, currency);

    if (minorUnits === null) {
      return null;
    }

    parsed.push(minorUnits < 0n ? -minorUnits : minorUnits);
  }

  return parsed;
}

export function computeAmountStatistics(amounts: readonly bigint[]): AmountStatistics | null {
  if (amounts.length === 0) {
    return null;
  }

  let minimum = amounts[0] ?? 0n;
  let maximum = amounts[0] ?? 0n;
  let total = 0n;

  for (const amount of amounts) {
    if (amount < minimum) {
      minimum = amount;
    }

    if (amount > maximum) {
      maximum = amount;
    }

    total += amount;
  }

  return {
    amounts: [...amounts],
    minimum,
    maximum,
    variance: maximum - minimum,
    total,
    count: amounts.length,
  };
}

/**
 * Compare la variation relative `(max - min) / moyenne` à un seuil exprimé en
 * pourcentage, **sans division** :
 *
 *   (max - min) / (total / n) ≤ seuil/100
 *   ⇔ (max - min) × n × 100 ≤ total × seuil
 *
 * Une moyenne nulle (impossible avec des montants strictement positifs, mais
 * traitée explicitement) est considérée comme sans variation : aucune division
 * par zéro n'est possible.
 */
export function relativeVarianceAtMost(
  statistics: AmountStatistics,
  thresholdPercent: number,
): boolean {
  if (statistics.total === 0n) {
    return true;
  }

  const left = statistics.variance * BigInt(statistics.count) * 100n;
  const right = statistics.total * BigInt(thresholdPercent);

  return left <= right;
}

/** Hausse (ou baisse) de prix observée sur la série (`specs/moteur-recurrence.md` §5). */
export interface PriceChange {
  previousAmount: string;
  currentAmount: string;
  /** Négatif en cas de baisse : le signe porte le sens de la variation. */
  absoluteChange: string;
  /** Pourcentage à deux décimales, arrondi au centième le plus proche. */
  percentageChange: string;
  /** Date de l'occurrence à laquelle le nouveau montant apparaît. */
  detectedAt: string;
  /** `true` seulement si le nouveau montant tient sur 2 occurrences consécutives. */
  confirmed: boolean;
}

/**
 * Nombre d'occurrences consécutives au nouveau montant nécessaires pour
 * qualifier une hausse de durable (§5) : une variation ponctuelle qui revient
 * à l'ancien montant n'est pas une hausse.
 */
export const CONFIRMATION_OCCURRENCES = 2;

export interface AmountObservation {
  date: string;
  amountMinorUnits: bigint;
}

/**
 * Détecte le dernier changement de montant de la série.
 *
 * Renvoie `null` si le montant n'a jamais changé. Sinon la variation est
 * décrite telle qu'observée, avec `confirmed` indiquant si le nouveau montant
 * s'est répété assez longtemps pour être considéré comme durable.
 */
export function detectPriceChange(
  observations: readonly AmountObservation[],
  currency: Currency,
): PriceChange | null {
  if (observations.length < 2) {
    return null;
  }

  let changeIndex = -1;

  for (let index = observations.length - 1; index >= 1; index -= 1) {
    const current = observations[index];
    const previous = observations[index - 1];

    if (current === undefined || previous === undefined) {
      continue;
    }

    if (current.amountMinorUnits !== previous.amountMinorUnits) {
      changeIndex = index;
      break;
    }
  }

  if (changeIndex === -1) {
    return null;
  }

  const change = observations[changeIndex];
  const before = observations[changeIndex - 1];

  if (change === undefined || before === undefined) {
    return null;
  }

  const runLength = observations
    .slice(changeIndex)
    .filter((observation) => observation.amountMinorUnits === change.amountMinorUnits).length;

  const absoluteChange = change.amountMinorUnits - before.amountMinorUnits;

  return {
    previousAmount: minorUnitsToDecimalString(before.amountMinorUnits, currency),
    currentAmount: minorUnitsToDecimalString(change.amountMinorUnits, currency),
    absoluteChange: minorUnitsToDecimalString(absoluteChange, currency),
    percentageChange: formatPercentageChange(before.amountMinorUnits, absoluteChange),
    detectedAt: change.date,
    confirmed: runLength >= CONFIRMATION_OCCURRENCES,
  };
}

/**
 * Pourcentage de variation, calculé en entiers puis formaté à deux décimales.
 *
 * Un montant de référence nul renvoie `0.00` : aucune division par zéro n'est
 * effectuée (§10).
 */
export function formatPercentageChange(previous: bigint, absoluteChange: bigint): string {
  if (previous === 0n) {
    return '0.00';
  }

  // × 10 000 pour conserver deux décimales après la division entière, puis
  // arrondi au centième le plus proche (règle fixe, donc reproductible).
  const scaled = absoluteChange * 10_000n;
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const divisor = previous < 0n ? -previous : previous;
  const rounded = (magnitude + divisor / 2n) / divisor;
  const digits = rounded.toString().padStart(3, '0');
  const formatted = `${digits.slice(0, digits.length - 2)}.${digits.slice(digits.length - 2)}`;

  return negative ? `-${formatted}` : formatted;
}
