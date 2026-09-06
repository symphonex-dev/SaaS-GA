import {
  divideMoneyByInteger,
  multiplyMoneyByInteger,
  percentageOfMoney,
  potentialSavingsBetween,
  zeroMoney,
  type BillingCycle,
  type Money,
} from '@subscription-manager/shared';

/**
 * Coûts comparés (`specs/comparateur-et-assistant-ia.md` A.4).
 *
 * Toute l'arithmétique est en unités mineures entières (`Money`), reprise du
 * moteur de `specs/calculs-financiers.md` §1 : aucun `number` ne porte jamais
 * une valeur monétaire (CLAUDE.md §5.2).
 *
 *   monthlyCost(mensuel) = prix
 *   monthlyCost(annuel)  = prix / 12
 *   annualCost(mensuel)  = prix × 12
 *   annualCost(annuel)   = prix
 *   total12MonthCost     = annualCost
 *   potentialSavings     = max(coûtActuel − coûtAlternatif, 0)
 */

const MONTHS_PER_YEAR = 12n;

export function monthlyCost(price: Money, cycle: BillingCycle): Money | null {
  return cycle === 'MONTHLY' ? price : divideMoneyByInteger(price, MONTHS_PER_YEAR);
}

export function annualCost(price: Money, cycle: BillingCycle): Money {
  return cycle === 'MONTHLY' ? multiplyMoneyByInteger(price, MONTHS_PER_YEAR) : price;
}

/** `total12MonthCost` de la spec : par définition égal au coût annuel (A.4). */
export function total12MonthCost(price: Money, cycle: BillingCycle): Money {
  return annualCost(price, cycle);
}

/**
 * Économie sur 12 mois.
 *
 * Une alternative plus chère ne produit jamais d'économie négative : le
 * résultat est ramené à zéro (A.4 — « une économie négative n'est jamais
 * affichée »). `null` si les deux montants ne partagent pas la même devise :
 * aucune conversion implicite n'est possible.
 */
export function potentialAnnualSavings(
  currentAnnual: Money,
  alternativeAnnual: Money,
): Money | null {
  return potentialSavingsBetween(currentAnnual, alternativeAnnual);
}

/**
 * Part économisée, en pourcentage exact à deux décimales.
 * `null` si le coût actuel est nul : aucune base de comparaison (§5 calculs).
 */
export function savingsPercentage(savings: Money, currentAnnual: Money): string | null {
  return percentageOfMoney(savings, currentAnnual);
}

/** Économie nulle dans la devise donnée : « aucune alternative » vaut zéro. */
export function noSavings(currency: Money['currency']): Money {
  return zeroMoney(currency);
}
