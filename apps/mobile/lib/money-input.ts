import { CURRENCY_MINOR_UNIT_EXPONENT, type Currency } from '@subscription-manager/shared';

/**
 * Encodage d'un montant **saisi par l'utilisateur** en unités mineures.
 *
 * ⚠️ Ce module ne calcule rien : il ne fait que transcrire ce que
 * l'utilisateur a tapé dans la forme attendue par l'API (`MoneyDto`). Aucune
 * addition, soustraction ni comparaison monétaire n'a lieu côté mobile — les
 * totaux, KPI et projections restent produits par `apps/api`
 * (CLAUDE.md §5.1).
 *
 * La transcription est faite **par manipulation de chaîne**, jamais par
 * arithmétique flottante : `parseFloat('13.49') * 100` vaut 1348.9999… et
 * produirait un centime faux (CLAUDE.md §5.2). C'est l'opération inverse de
 * `toDecimalString()` dans `lib/money.ts`.
 */
const AMOUNT_PATTERN = /^(\d{1,15})(?:[.,](\d{1,4}))?$/;

export interface ParsedAmount {
  minorUnits: string;
}

/**
 * `« 13,49 »` → `{ minorUnits: '1349' }` pour une devise à 2 décimales.
 *
 * Renvoie `null` si la saisie n'est pas un montant positif exprimable
 * exactement dans la devise : plus de décimales que la devise n'en porte, un
 * signe, une lettre, ou zéro. Rien n'est arrondi en silence — arrondir la
 * saisie d'un utilisateur reviendrait à enregistrer un montant qu'il n'a pas
 * écrit.
 */
export function parseAmountToMinorUnits(input: string, currency: Currency): ParsedAmount | null {
  const exponent = CURRENCY_MINOR_UNIT_EXPONENT[currency];
  const match = AMOUNT_PATTERN.exec(input.trim().replace(/\s/g, ''));

  if (match === null) {
    return null;
  }

  const integerPart = match[1] ?? '';
  const fractionPart = match[2] ?? '';

  if (fractionPart.length > exponent) {
    return null;
  }

  const digits = `${integerPart}${fractionPart.padEnd(exponent, '0')}`;
  const normalized = digits.replace(/^0+(?=\d)/, '');

  return normalized === '0' ? null : { minorUnits: normalized };
}

/**
 * `'1349'` → `'13.49'` : valeur d'édition d'un montant déjà enregistré.
 *
 * Manipulation de chaîne également : la valeur affichée dans le champ est
 * exactement celle que le serveur a stockée.
 */
export function minorUnitsToInputValue(minorUnits: string, currency: Currency): string {
  const exponent = CURRENCY_MINOR_UNIT_EXPONENT[currency];
  const negative = minorUnits.startsWith('-');
  const digits = (negative ? minorUnits.slice(1) : minorUnits).padStart(exponent + 1, '0');

  if (exponent === 0) {
    return `${negative ? '-' : ''}${digits}`;
  }

  const integerPart = digits.slice(0, digits.length - exponent);
  const fractionPart = digits.slice(digits.length - exponent);

  return `${negative ? '-' : ''}${integerPart}.${fractionPart}`;
}

/** `2026-09-05` → `2026-09-05T00:00:00.000Z`, la forme attendue par l'API. */
export function isoDateToDateTime(isoDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate.trim())) {
    return null;
  }

  const parsed = new Date(`${isoDate.trim()}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  // `new Date('2026-02-31')` ne lève pas : il décale au 3 mars. On refuse une
  // date que le calendrier ne contient pas plutôt que d'en enregistrer une autre.
  return parsed.toISOString().slice(0, 10) === isoDate.trim() ? parsed.toISOString() : null;
}

/** `2026-09-05T00:00:00.000Z` → `2026-09-05`, pour préremplir le champ. */
export function dateTimeToIsoDate(isoDateTime: string): string {
  return isoDateTime.slice(0, 10);
}
