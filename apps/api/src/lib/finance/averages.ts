import { averageMoney, monthlyFromAnnual, type Money } from '@subscription-manager/shared';

import type { FinanceLine } from './totals';

/**
 * Moyennes (`specs/calculs-financiers.md` §4).
 *
 * Une moyenne sur une série vide renvoie `null`, jamais zéro : « aucune
 * donnée » et « zéro euro » sont deux informations différentes.
 */

/** Coût moyen d'une série de dépenses. `null` si la série est vide. */
export function averageOfLines(lines: readonly FinanceLine[]): Money | null {
  return averageMoney(lines.map((line) => line.amount));
}

/** Coût mensuel moyen d'un coût annuel récurrent (`annuel / 12`). */
export function averageMonthlyCost(annualRecurringCost: Money): Money | null {
  return monthlyFromAnnual(annualRecurringCost);
}

/**
 * Moyenne mensuelle observée sur une série de totaux mensuels.
 *
 * Les mois sans dépense doivent être fournis à zéro par l'appelant : les
 * ignorer surestimerait la moyenne (§9).
 */
export function averageMonthly(monthlyTotals: readonly Money[]): Money | null {
  return averageMoney(monthlyTotals);
}
