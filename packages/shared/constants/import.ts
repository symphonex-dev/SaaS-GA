/**
 * Constantes du pipeline d'import (`specs/import-releves.md`).
 *
 * Les codes d'erreur de ligne sont partagés avec le mobile : celui-ci affiche un
 * message localisé à partir du code, jamais le message technique du serveur.
 */

/** Codes d'erreur de ligne — liste fermée, définie par `specs/import-releves.md` §7. */
export const IMPORT_ROW_ERROR_CODES = {
  CSV_MISSING_DATE: 'CSV_MISSING_DATE',
  CSV_INVALID_DATE: 'CSV_INVALID_DATE',
  CSV_MISSING_DESCRIPTION: 'CSV_MISSING_DESCRIPTION',
  CSV_MISSING_AMOUNT: 'CSV_MISSING_AMOUNT',
  CSV_INVALID_AMOUNT: 'CSV_INVALID_AMOUNT',
  CSV_AMBIGUOUS_DATE: 'CSV_AMBIGUOUS_DATE',
  CSV_INVALID_CURRENCY: 'CSV_INVALID_CURRENCY',
  CSV_DUPLICATE: 'CSV_DUPLICATE',
  CSV_REFUND: 'CSV_REFUND',
  PDF_LOW_CONFIDENCE_LINE: 'PDF_LOW_CONFIDENCE_LINE',
} as const;

export type ImportRowErrorCode =
  (typeof IMPORT_ROW_ERROR_CODES)[keyof typeof IMPORT_ROW_ERROR_CODES];

/** Séparateurs CSV supportés (`specs/import-releves.md` §4.2). */
export const CSV_DELIMITERS = [',', ';', '\t'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/**
 * Ordre des composantes d'une date numérique.
 *
 * Une date comme `03/04/2026` est ambiguë : elle n'est jamais devinée. L'ordre
 * est déduit du pays choisi à l'onboarding, et reste modifiable par
 * l'utilisateur au moment de la confirmation (§4.6).
 */
export const DATE_ORDERS = ['DMY', 'MDY'] as const;
export type DateOrder = (typeof DATE_ORDERS)[number];

/** Pays utilisant l'ordre mois/jour/année pour les dates numériques. */
export const MONTH_FIRST_COUNTRIES: readonly string[] = ['US', 'PH', 'FM', 'MH', 'PW'];

export function dateOrderForCountry(country: string): DateOrder {
  return MONTH_FIRST_COUNTRIES.includes(country) ? 'MDY' : 'DMY';
}

/** Sens d'un mouvement bancaire (`specs/import-releves.md` §6). */
export const TRANSACTION_DIRECTIONS = ['DEBIT', 'CREDIT'] as const;
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number];

/** Confiance d'un rapprochement de doublon (§8). */
export const DUPLICATE_CONFIDENCES = ['HIGH', 'MEDIUM'] as const;
export type DuplicateConfidence = (typeof DUPLICATE_CONFIDENCES)[number];

/** Confiance d'une ligne extraite d'un PDF (§5). */
export const PDF_LINE_CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type PdfLineConfidence = (typeof PDF_LINE_CONFIDENCES)[number];

/**
 * Message produit obligatoire, affiché avant tout import PDF (§5).
 * Ne jamais promettre une compatibilité avec « tous les relevés PDF ».
 */
export const PDF_COMPATIBILITY_NOTICE_KEY = 'import.pdf.limitedCompatibility';

/**
 * Fenêtre de rapprochement d'un remboursement, en jours (§6) : un crédit du
 * même commerçant, de montant opposé, dans cette fenêtre autour d'un débit.
 */
export const REFUND_MATCH_WINDOW_DAYS = 90;
