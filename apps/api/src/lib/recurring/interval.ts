/**
 * Calcul des intervalles entre occurrences
 * (`specs/moteur-recurrence.md` §4).
 *
 * Les dates sont des dates calendaires ISO (`2026-01-05`), interprétées à
 * minuit UTC : aucun fuseau local n'intervient, donc aucun décalage d'un jour
 * selon la machine qui exécute le moteur. C'est une condition du déterminisme.
 */
const MILLISECONDS_PER_DAY = 86_400_000;

/** Nombre de jours calendaires entre deux dates ISO (valeur absolue). */
export function daysBetween(earlier: string, later: string): number {
  const from = Date.parse(`${earlier}T00:00:00.000Z`);
  const to = Date.parse(`${later}T00:00:00.000Z`);

  return Math.abs(Math.round((to - from) / MILLISECONDS_PER_DAY));
}

/** Trie les dates par ordre croissant, sans muter l'entrée. */
export function sortDates(dates: readonly string[]): string[] {
  return [...dates].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Intervalles successifs `d_i - d_(i-1)`, en jours.
 * Les dates sont triées au préalable : l'ordre du fichier importé n'influe
 * jamais sur le résultat.
 */
export function computeIntervals(dates: readonly string[]): number[] {
  const sorted = sortDates(dates);
  const intervals: number[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];

    if (previous === undefined || current === undefined) {
      continue;
    }

    intervals.push(daysBetween(previous, current));
  }

  return intervals;
}

/**
 * Médiane entière des intervalles.
 *
 * La médiane est préférée à la moyenne : une occurrence isolée très éloignée
 * (paiement rattrapé, mois sauté) ne doit pas déplacer la période observée.
 * Pour un nombre pair d'intervalles, la moyenne des deux valeurs centrales est
 * arrondie à l'entier inférieur — règle fixe, donc reproductible.
 */
export function medianInterval(intervals: readonly number[]): number | null {
  if (intervals.length === 0) {
    return null;
  }

  const sorted = [...intervals].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }

  const lower = sorted[middle - 1];
  const upper = sorted[middle];

  if (lower === undefined || upper === undefined) {
    return null;
  }

  return Math.floor((lower + upper) / 2);
}

/** Étendue de l'historique observé, en jours. */
export function spanDays(dates: readonly string[]): number {
  const sorted = sortDates(dates);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (first === undefined || last === undefined) {
    return 0;
  }

  return daysBetween(first, last);
}
