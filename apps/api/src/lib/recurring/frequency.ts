import type { ExpenseFrequency } from '@subscription-manager/shared';

import { medianInterval } from './interval';

/**
 * Classification de la périodicité (`specs/moteur-recurrence.md` §4).
 *
 * Ces fenêtres sont la **seule** définition des périodes du projet : elles ne
 * doivent être dupliquées nulle part ailleurs.
 */
export const RECURRENCE_WINDOWS = {
  WEEKLY: { targetDays: 7, toleranceDays: 2 },
  MONTHLY: { targetDays: 30, toleranceDays: 5 },
  QUARTERLY: { targetDays: 91, toleranceDays: 10 },
  YEARLY: { targetDays: 365, toleranceDays: 20 },
} as const;

export type PeriodicFrequency = keyof typeof RECURRENCE_WINDOWS;

/** Bornes effectives d'une fenêtre : `[cible - tolérance, cible + tolérance]`. */
export function windowBounds(frequency: PeriodicFrequency): { min: number; max: number } {
  const window = RECURRENCE_WINDOWS[frequency];

  return {
    min: window.targetDays - window.toleranceDays,
    max: window.targetDays + window.toleranceDays,
  };
}

export function isWithinWindow(intervalDays: number, frequency: PeriodicFrequency): boolean {
  const { min, max } = windowBounds(frequency);

  return intervalDays >= min && intervalDays <= max;
}

/**
 * Nombre minimal d'occurrences pour une détection standard (§3).
 * Une seule transaction n'est jamais récurrente, deux ne suffisent pas.
 */
export const MINIMUM_OCCURRENCES = 3;

/**
 * Classification `IRREGULAR_RECURRING` : volontairement conservatrice (§4).
 *
 * Elle exige davantage qu'une périodicité nommée — plus d'occurrences, un
 * historique plus long, et des intervalles qui restent dans le même ordre de
 * grandeur — pour éviter de qualifier de « récurrentes » des dépenses
 * simplement fréquentes chez le même commerçant.
 */
export const IRREGULAR_RULES = {
  minimumOccurrences: 4,
  minimumSpanDays: 90,
  /** Au-delà, deux paiements ne relèvent plus du même rythme. */
  maximumIntervalDays: 120,
  /**
   * Chaque intervalle doit rester entre la moitié et le double de la médiane :
   * la répétition doit être statistiquement lisible, pas seulement présente.
   */
  medianRatio: 2,
} as const;

/**
 * Fraction d'intervalles devant tomber dans la fenêtre pour retenir une
 * périodicité : « la majorité » au sens strict (§4).
 */
function hasMajority(matching: number, total: number): boolean {
  return total > 0 && matching * 2 > total;
}

export interface FrequencyClassification {
  frequency: ExpenseFrequency | null;
  /** Intervalle médian observé, en jours. */
  intervalDays: number | null;
  /** `true` si la fréquence retenue est une périodicité nommée (non irrégulière). */
  periodic: boolean;
}

/**
 * Détermine la périodicité à partir des intervalles observés.
 *
 * Les fenêtres étant disjointes, au plus une périodicité peut réunir une
 * majorité d'intervalles : le résultat ne dépend donc pas de l'ordre d'examen.
 */
export function classifyFrequency(
  intervals: readonly number[],
  spanDays: number,
  occurrences: number,
): FrequencyClassification {
  const median = medianInterval(intervals);

  if (intervals.length === 0 || median === null || occurrences < MINIMUM_OCCURRENCES) {
    return { frequency: null, intervalDays: median, periodic: false };
  }

  for (const frequency of Object.keys(RECURRENCE_WINDOWS) as PeriodicFrequency[]) {
    const matching = intervals.filter((interval) => isWithinWindow(interval, frequency)).length;

    if (hasMajority(matching, intervals.length)) {
      return { frequency, intervalDays: median, periodic: true };
    }
  }

  return {
    frequency: isIrregularRecurring(intervals, spanDays, occurrences, median)
      ? 'IRREGULAR_RECURRING'
      : null,
    intervalDays: median,
    periodic: false,
  };
}

function isIrregularRecurring(
  intervals: readonly number[],
  spanDays: number,
  occurrences: number,
  median: number,
): boolean {
  if (
    occurrences < IRREGULAR_RULES.minimumOccurrences ||
    spanDays < IRREGULAR_RULES.minimumSpanDays ||
    median <= 0
  ) {
    return false;
  }

  const lowerBound = median / IRREGULAR_RULES.medianRatio;
  const upperBound = median * IRREGULAR_RULES.medianRatio;

  return intervals.every(
    (interval) =>
      interval <= IRREGULAR_RULES.maximumIntervalDays &&
      interval >= lowerBound &&
      interval <= upperBound,
  );
}
