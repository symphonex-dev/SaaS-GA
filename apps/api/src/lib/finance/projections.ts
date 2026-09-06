import {
  annualizeIrregular,
  annualizeRecurring,
  type ExpenseFrequency,
  type Money,
} from '@subscription-manager/shared';

/**
 * Projections (`specs/calculs-financiers.md` §4 et §8).
 *
 * Une projection est toujours une **prévision** : la prochaine échéance est
 * présentée comme telle au client, jamais comme une certitude.
 */
export function annualizedCost(amount: Money, frequency: ExpenseFrequency): Money | null {
  return annualizeRecurring(amount, frequency);
}

export function annualizedIrregularCost(
  total: Money,
  elapsedDays: number,
  occurrences: number,
): Money | null {
  return annualizeIrregular(total, elapsedDays, occurrences);
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, monthIndex: number): number {
  if (monthIndex === 1 && isLeapYear(year)) {
    return 29;
  }

  return MONTH_LENGTHS[monthIndex] ?? 30;
}

function toIso(year: number, monthIndex: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Ajoute des mois en **préservant le jour du mois** quand c'est possible
 * (§8 : `31 janvier → 28/29 février`, jamais une date invalide).
 */
export function addMonthsPreservingDay(isoDate: string, months: number): string {
  const [yearPart = '1970', monthPart = '01', dayPart = '01'] = isoDate.split('-');
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  const day = Number(dayPart);

  const totalMonths = year * 12 + monthIndex + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));

  return toIso(targetYear, targetMonth, clampedDay);
}

/** Ajoute un nombre de jours calendaires à une date ISO. */
export function addDays(isoDate: string, days: number): string {
  const timestamp = Date.parse(`${isoDate}T00:00:00.000Z`) + days * 86_400_000;

  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Prochaine échéance prévisionnelle : `dernier paiement + intervalle estimé`.
 *
 * Les périodicités mensuelles, trimestrielles et annuelles avancent en mois
 * civils pour préserver le jour de prélèvement ; les hebdomadaires et les
 * séries irrégulières avancent de l'intervalle médian observé.
 *
 * Renvoie `null` quand aucune prévision n'est défendable (`ONCE`, ou série
 * irrégulière sans intervalle observé) : mieux vaut ne rien annoncer.
 */
export function nextExpectedDate(
  lastPaymentDate: string,
  frequency: ExpenseFrequency,
  intervalDays: number | null,
): string | null {
  switch (frequency) {
    case 'MONTHLY':
      return addMonthsPreservingDay(lastPaymentDate, 1);
    case 'QUARTERLY':
      return addMonthsPreservingDay(lastPaymentDate, 3);
    case 'YEARLY':
      return addMonthsPreservingDay(lastPaymentDate, 12);
    case 'WEEKLY':
      return addDays(lastPaymentDate, 7);
    case 'IRREGULAR_RECURRING':
      return intervalDays === null || intervalDays <= 0
        ? null
        : addDays(lastPaymentDate, intervalDays);
    case 'ONCE':
    default:
      return null;
  }
}
