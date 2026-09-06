import {
  CURRENCY_MINOR_UNIT_EXPONENT,
  type Currency,
  type MoneyDto,
} from '@subscription-manager/shared';

/**
 * Formatage des montants pour l'affichage.
 *
 * ⚠️ Ce module **ne calcule rien**. Tous les montants arrivent déjà calculés
 * par `apps/api` (CLAUDE.md §5.1) : il ne fait que passer d'unités mineures à
 * une chaîne lisible, dans la locale de l'utilisateur.
 *
 * La conversion en `number` n'a lieu qu'ici, uniquement pour appeler
 * `Intl.NumberFormat`, et uniquement sur une valeur déjà arrêtée par le
 * serveur. Aucune addition, soustraction ou comparaison monétaire n'est faite
 * côté mobile — c'est la règle §5.2 de CLAUDE.md.
 */
function exponentFor(currency: string): number {
  return currency in CURRENCY_MINOR_UNIT_EXPONENT
    ? CURRENCY_MINOR_UNIT_EXPONENT[currency as Currency]
    : 2;
}

/** Insère la virgule décimale par manipulation de chaîne, sans arithmétique. */
export function toDecimalString(money: MoneyDto): string {
  const exponent = exponentFor(money.currency);
  const negative = money.minorUnits.startsWith('-');
  const digits = (negative ? money.minorUnits.slice(1) : money.minorUnits).padStart(
    exponent + 1,
    '0',
  );

  const integerPart = digits.slice(0, digits.length - exponent);
  const fractionPart = digits.slice(digits.length - exponent);
  const formatted = exponent === 0 ? integerPart : `${integerPart}.${fractionPart}`;

  return negative ? `-${formatted}` : formatted;
}

/** Montant localisé avec son symbole (« 13,49 € », « $13.49 »). */
export function formatMoney(money: MoneyDto, locale: string): string {
  const decimal = toDecimalString(money);

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: money.currency,
      minimumFractionDigits: exponentFor(money.currency),
    }).format(Number(decimal));
  } catch {
    // Devise inconnue de la plateforme : on affiche la valeur exacte suivie du
    // code ISO plutôt que rien (`specs/calculs-financiers.md` §7).
    return `${decimal} ${money.currency}`;
  }
}

/**
 * Libellé accessible d'un montant : la valeur exacte est toujours annoncée,
 * même si l'affichage visuel est abrégé (§14).
 */
export function moneyAccessibilityLabel(money: MoneyDto, locale: string): string {
  return formatMoney(money, locale);
}

/** Pourcentage déjà calculé par le serveur, formaté pour l'affichage. */
export function formatPercentage(percentage: string | null, locale: string): string | null {
  if (percentage === null) {
    return null;
  }

  try {
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    }).format(Number(percentage) / 100);
  } catch {
    return `${percentage} %`;
  }
}

/**
 * Test d'absence de montant.
 *
 * Comparaison de chaîne, pas une opération arithmétique : l'écran ne fait que
 * distinguer « rien à afficher » de « une valeur à afficher ».
 */
export function isZeroAmount(money: MoneyDto): boolean {
  return money.minorUnits === '0' || money.minorUnits === '-0';
}

/** Date ISO (`2026-01-05`) rendue dans la locale de l'utilisateur. */
export function formatDate(isoDate: string, locale: string): string {
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

/** Mois `YYYY-MM` rendu en libellé court (« janv. 2026 »). */
export function formatMonth(month: string, locale: string): string {
  const parsed = new Date(`${month}-01T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return month;
  }

  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(parsed);
}
