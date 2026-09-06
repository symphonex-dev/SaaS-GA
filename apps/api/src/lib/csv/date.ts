import type { DateOrder } from '@subscription-manager/shared';

/**
 * Analyse des dates (`specs/import-releves.md` §4.6).
 *
 * Formats supportés : `YYYY-MM-DD`, `YYYY/MM/DD`, `DD/MM/YYYY`, `DD-MM-YYYY`,
 * `MM/DD/YYYY`, plus la variante à deux chiffres d'année.
 *
 * Une date numérique ambiguë (`03/04/2026`) n'est jamais devinée : elle est
 * tranchée par l'ordre déduit du pays choisi à l'onboarding, et le résultat
 * signale explicitement qu'une interprétation a été appliquée, pour que
 * l'utilisateur puisse la corriger avant confirmation.
 */
export type DateParseFailure = 'MISSING' | 'INVALID' | 'AMBIGUOUS';

export interface ParsedDate {
  /** Date ISO 8601 sans composante horaire (`2026-01-05`). */
  iso: string;
  /**
   * `true` si l'entrée pouvait se lire dans les deux ordres et que seul
   * `dateOrder` a permis de trancher.
   */
  ambiguous: boolean;
}

export type DateParseResult =
  { ok: true; date: ParsedDate } | { ok: false; reason: DateParseFailure };

const ISO_PATTERN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
const NUMERIC_PATTERN = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/;

/** Vérifie l'existence réelle de la date (rejette `31/02/2026`, `2026-02-30`). */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function toIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Année sur deux chiffres : fenêtre glissante centrée sur le siècle courant. */
function expandTwoDigitYear(year: number): number {
  return year >= 70 ? 1900 + year : 2000 + year;
}

/**
 * @param dateOrder ordre à appliquer aux dates numériques ambiguës. `undefined`
 *   signifie « aucune indication » : une date ambiguë est alors refusée
 *   (`AMBIGUOUS`) plutôt que devinée.
 */
export function parseCsvDate(input: string, dateOrder?: DateOrder): DateParseResult {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: 'MISSING' };
  }

  const isoMatch = ISO_PATTERN.exec(trimmed);

  if (isoMatch !== null) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);

    // L'ordre est explicite dans le format : aucune ambiguïté possible.
    return isRealDate(year, month, day)
      ? { ok: true, date: { iso: toIso(year, month, day), ambiguous: false } }
      : { ok: false, reason: 'INVALID' };
  }

  const numericMatch = NUMERIC_PATTERN.exec(trimmed);

  if (numericMatch === null) {
    return { ok: false, reason: 'INVALID' };
  }

  const first = Number(numericMatch[1]);
  const second = Number(numericMatch[2]);
  const rawYear = numericMatch[3] ?? '';
  const year = rawYear.length === 2 ? expandTwoDigitYear(Number(rawYear)) : Number(rawYear);

  const asDayMonth = isRealDate(year, second, first);
  const asMonthDay = isRealDate(year, first, second);

  if (!asDayMonth && !asMonthDay) {
    return { ok: false, reason: 'INVALID' };
  }

  // Un seul ordre donne une date réelle : la lecture est certaine.
  if (asDayMonth && !asMonthDay) {
    return { ok: true, date: { iso: toIso(year, second, first), ambiguous: false } };
  }

  if (asMonthDay && !asDayMonth) {
    return { ok: true, date: { iso: toIso(year, first, second), ambiguous: false } };
  }

  // Les deux lectures sont possibles : seule la locale de l'utilisateur tranche.
  if (dateOrder === undefined) {
    return { ok: false, reason: 'AMBIGUOUS' };
  }

  // Deux composantes identiques (05/05/2026) : les deux lectures coïncident.
  const genuinelyAmbiguous = first !== second;

  return dateOrder === 'DMY'
    ? { ok: true, date: { iso: toIso(year, second, first), ambiguous: genuinelyAmbiguous } }
    : { ok: true, date: { iso: toIso(year, first, second), ambiguous: genuinelyAmbiguous } };
}

/** Convertit une date ISO (jour) en `Date` UTC à minuit, pour le stockage. */
export function isoDateToUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
