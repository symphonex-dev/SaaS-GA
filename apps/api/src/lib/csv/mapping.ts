import type { CsvColumnMapping } from '@subscription-manager/shared';

/**
 * Mapping automatique des colonnes (`specs/import-releves.md` §4.4).
 *
 * Heuristiques explicites uniquement, à partir des en-têtes. Le mapping proposé
 * est toujours modifiable par l'utilisateur avant l'import définitif : il est
 * renvoyé dans l'aperçu et peut être remplacé dans `POST /api/imports/confirm`.
 */
const HEADER_PATTERNS = {
  date: [/^date$/, /date/, /^jour$/, /^valeur$/, /^value date$/, /^transaction date$/],
  amount: [
    /^amount$/,
    /^montant$/,
    /^value$/,
    /^somme$/,
    /^betrag$/,
    /^importe$/,
    /montant/,
    /amount/,
  ],
  description: [
    /^description$/,
    /^libell[ée]$/,
    /^libelle$/,
    /^label$/,
    /^details?$/,
    /^d[ée]tails?$/,
    /^narrative$/,
    /^payee$/,
    /^merchant$/,
    /^commer[çc]ant$/,
    /^nature$/,
    /^operation$/,
    /^op[ée]ration$/,
    /libell/,
    /description/,
  ],
  debit: [/^debit$/, /^d[ée]bit$/, /^withdrawal$/, /^retrait$/, /^sortie$/, /debit/, /withdrawal/],
  credit: [
    /^credit$/,
    /^cr[ée]dit$/,
    /^deposit$/,
    /^d[ée]p[ôo]t$/,
    /^entr[ée]e$/,
    /credit/,
    /deposit/,
  ],
  currency: [/^currency$/, /^devise$/, /^monnaie$/, /^ccy$/, /currency/, /devise/],
} as const;

function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findColumn(headers: readonly string[], patterns: readonly RegExp[]): number | undefined {
  const normalized = headers.map(normalizeHeader);

  // Les motifs sont ordonnés du plus strict au plus permissif : une
  // correspondance exacte l'emporte toujours sur une correspondance partielle.
  for (const pattern of patterns) {
    const index = normalized.findIndex((header) => pattern.test(header));

    if (index !== -1) {
      return index;
    }
  }

  return undefined;
}

/**
 * Détermine si la première ligne est un en-tête : au moins deux cellules non
 * numériques et au moins une correspondance d'en-tête connue.
 */
export function looksLikeHeaderRow(row: readonly string[]): boolean {
  const nonNumeric = row.filter((cell) => cell.trim().length > 0 && !/^[\d\s.,+-]+$/.test(cell));

  if (nonNumeric.length < 2) {
    return false;
  }

  return (
    findColumn(row, HEADER_PATTERNS.date) !== undefined ||
    findColumn(row, HEADER_PATTERNS.amount) !== undefined ||
    findColumn(row, HEADER_PATTERNS.debit) !== undefined
  );
}

export interface MappingDetection {
  mapping: CsvColumnMapping | null;
  /** Colonnes obligatoires introuvables — l'utilisateur doit les désigner. */
  missing: Array<'date' | 'amount' | 'description'>;
}

/**
 * Propose un mapping à partir des en-têtes.
 *
 * Une colonne `amount` unique, ou un couple `debit`/`credit`, sont acceptés :
 * beaucoup de banques exportent les deux sens dans des colonnes distinctes.
 */
export function detectMapping(headers: readonly string[]): MappingDetection {
  const dateColumn = findColumn(headers, HEADER_PATTERNS.date);
  const descriptionColumn = findColumn(headers, HEADER_PATTERNS.description);
  const amountColumn = findColumn(headers, HEADER_PATTERNS.amount);
  const debitColumn = findColumn(headers, HEADER_PATTERNS.debit);
  const creditColumn = findColumn(headers, HEADER_PATTERNS.credit);
  const currencyColumn = findColumn(headers, HEADER_PATTERNS.currency);

  const missing: Array<'date' | 'amount' | 'description'> = [];

  if (dateColumn === undefined) {
    missing.push('date');
  }

  if (descriptionColumn === undefined) {
    missing.push('description');
  }

  // La colonne « montant » peut être portée par le couple débit/crédit.
  const effectiveAmountColumn = amountColumn ?? debitColumn ?? creditColumn;

  if (effectiveAmountColumn === undefined) {
    missing.push('amount');
  }

  if (
    dateColumn === undefined ||
    descriptionColumn === undefined ||
    effectiveAmountColumn === undefined
  ) {
    return { mapping: null, missing };
  }

  const mapping: CsvColumnMapping = {
    dateColumn,
    amountColumn: effectiveAmountColumn,
    descriptionColumn,
  };

  if (debitColumn !== undefined) {
    mapping.debitColumn = debitColumn;
  }

  if (creditColumn !== undefined) {
    mapping.creditColumn = creditColumn;
  }

  if (currencyColumn !== undefined) {
    mapping.currencyColumn = currencyColumn;
  }

  return { mapping, missing };
}
