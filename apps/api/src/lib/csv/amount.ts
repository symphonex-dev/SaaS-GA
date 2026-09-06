/**
 * Analyse des montants (`specs/import-releves.md` §4.5).
 *
 * Aucun `parseFloat` : le résultat est une chaîne décimale exacte, convertie
 * plus loin en unités mineures entières (CLAUDE.md §5.2). Un format ambigu
 * n'est jamais deviné au hasard — les règles ci-dessous sont explicites et
 * déterministes.
 */
export interface ParsedMoney {
  /** Valeur absolue, décimale exacte, sans séparateur de milliers (`1234.56`). */
  value: string;
  sign: 'positive' | 'negative';
}

/** Indication de format issue de la locale de l'utilisateur. */
export type DecimalSeparatorHint = 'comma' | 'dot';

const CURRENCY_SYMBOLS_AND_CODES = /[€$£¥]|\b(?:EUR|USD|GBP|CAD|AUD|CHF)\b|\bTTC\b|\bHT\b/gi;

/**
 * Espaces servant de séparateur de milliers : espace ordinaire, espace
 * insécable (U+00A0), espace insécable étroite (U+202F) et apostrophe (usage
 * suisse). Écrites en séquences d'échappement pour rester visibles en relecture.
 */
const SPACE_LIKE = /[\s\u00A0\u202F']/g;

/**
 * Isole le cœur numérique et le signe.
 *
 * Renvoie `null` si la position ou le nombre de signes est incohérent
 * (« --12 », « 1-2 ») : mieux vaut refuser une valeur douteuse que lui prêter
 * une interprétation.
 */
function stripToNumericCore(input: string): { core: string; negative: boolean } | null {
  let working = input.trim().replace(CURRENCY_SYMBOLS_AND_CODES, ' ').replace(SPACE_LIKE, '');

  // Parenthèses comptables : (12,34) signifie un montant négatif.
  const accountingNegative = /^\(.*\)$/.test(working);

  if (accountingNegative) {
    working = working.slice(1, -1);
  }

  const signs = working.match(/[+-]/g) ?? [];

  if (signs.length > 1) {
    return null;
  }

  // Un signe n'est admis qu'en tête ou en fin de valeur (« -12 », « 12- »).
  if (signs.length === 1 && !/^[+-]/.test(working) && !/[+-]$/.test(working)) {
    return null;
  }

  return {
    core: working.replace(/[+-]/g, ''),
    negative: accountingNegative || signs[0] === '-',
  };
}

/**
 * Interprète les séparateurs `.` et `,`.
 *
 * Règles, dans l'ordre :
 *  1. les deux séparateurs présents → le dernier est le séparateur décimal
 *     (`1.234,56` → virgule décimale ; `1,234.56` → point décimal) ;
 *  2. un seul séparateur, groupes de 3 chiffres réguliers **et** plusieurs
 *     occurrences → séparateur de milliers (`1.234.567`) ;
 *  3. un seul séparateur suivi d'exactement 3 chiffres → ambigu : tranché par
 *     la locale (`1,234` vaut 1234 en anglais, 1,234 en français) ;
 *  4. sinon → séparateur décimal.
 */
function normalizeSeparators(core: string, hint: DecimalSeparatorHint | undefined): string | null {
  if (!/^[0-9.,]+$/.test(core) || core.length === 0) {
    return null;
  }

  const lastDot = core.lastIndexOf('.');
  const lastComma = core.lastIndexOf(',');

  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSeparator = lastDot > lastComma ? '.' : ',';
    const thousandSeparator = decimalSeparator === '.' ? ',' : '.';

    return core.replaceAll(thousandSeparator, '').replace(decimalSeparator, '.');
  }

  const separator = lastDot !== -1 ? '.' : lastComma !== -1 ? ',' : null;

  if (separator === null) {
    return core;
  }

  const parts = core.split(separator);
  const tail = parts[parts.length - 1] ?? '';

  if (parts.length > 2) {
    // Plusieurs occurrences : nécessairement un séparateur de milliers.
    return parts.every((part, index) => (index === 0 ? part.length > 0 : part.length === 3))
      ? parts.join('')
      : null;
  }

  if (tail.length === 3) {
    // `1,234` / `1.234` : tranché par la locale, jamais au hasard.
    const decimalSeparator = hint === 'comma' ? ',' : hint === 'dot' ? '.' : null;

    if (decimalSeparator === null) {
      // Sans indication, la convention la plus répandue sur les relevés est le
      // séparateur de milliers : 1,234 = mille deux cent trente-quatre.
      return parts.join('');
    }

    return separator === decimalSeparator ? parts.join('.') : parts.join('');
  }

  if (tail.length > 3) {
    // Plus de 3 décimales : c'est forcément un séparateur décimal.
    return parts.join('.');
  }

  return parts.join('.');
}

/**
 * `localeHint` provient de la locale/du pays choisis à l'onboarding, jamais
 * d'une déduction sur le contenu du fichier.
 */
export function parseMoney(input: string, localeHint?: DecimalSeparatorHint): ParsedMoney | null {
  if (input.trim().length === 0) {
    return null;
  }

  const stripped = stripToNumericCore(input);

  if (stripped === null) {
    return null;
  }

  const { core, negative } = stripped;
  const normalized = normalizeSeparators(core, localeHint);

  if (normalized === null || normalized.length === 0) {
    return null;
  }

  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  // Normalisation d'affichage : suppression des zéros de tête superflus.
  const [integerPart = '0', fractionPart] = normalized.split('.');
  const cleanedInteger = integerPart.replace(/^0+(?=\d)/, '');
  const value = fractionPart === undefined ? cleanedInteger : `${cleanedInteger}.${fractionPart}`;

  return { value, sign: negative ? 'negative' : 'positive' };
}

/** Indication de séparateur décimal déduite du pays choisi à l'onboarding. */
export function decimalHintForCountry(country: string): DecimalSeparatorHint {
  const dotCountries = ['US', 'GB', 'CA', 'AU', 'IE', 'NZ', 'IN', 'JP', 'CN', 'MX', 'PH'];

  return dotCountries.includes(country) ? 'dot' : 'comma';
}
