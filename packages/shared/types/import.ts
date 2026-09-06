import type { CountryCode } from '../constants/countries';
import type { Currency } from '../constants/currencies';
import type { CsvRowStatus, ImportSourceType } from '../constants/enums';
import type {
  CsvDelimiter,
  DateOrder,
  DuplicateConfidence,
  ImportRowErrorCode,
  PdfLineConfidence,
  TransactionDirection,
} from '../constants/import';
import type { Id, IsoDateTimeString } from './common';

/**
 * DTO du pipeline d'import (`specs/import-releves.md`).
 *
 * Le mobile n'effectue aucun parsing, aucune détection et aucun calcul : il
 * affiche l'aperçu produit par `apps/api` et renvoie l'arbitrage de
 * l'utilisateur (CLAUDE.md §5.1).
 */

/** Mapping des colonnes CSV (§4.4). Indices 0-based dans la ligne parsée. */
export interface CsvColumnMapping {
  dateColumn: number;
  amountColumn: number;
  descriptionColumn: number;
  debitColumn?: number;
  creditColumn?: number;
  currencyColumn?: number;
}

export interface ImportRowError {
  code: ImportRowErrorCode;
  field?: string;
  /** Message technique non localisé : l'affichage passe par l'i18n, via le code. */
  message: string;
}

/** Valeurs retenues pour une ligne exploitable (§7). */
export interface ParsedRowValues {
  merchantRaw: string;
  merchantNormalized: string;
  /** Montant décimal exact, toujours positif — le sens est porté par `direction`. */
  amount: string;
  currency: Currency;
  /** Date ISO 8601 (`2026-01-05`). */
  date: string;
  direction: TransactionDirection;
}

export interface ParsedRow {
  rowNumber: number;
  status: CsvRowStatus;
  raw: Record<string, string>;
  parsed?: ParsedRowValues;
  errors: ImportRowError[];
}

/** Rapprochement avec une dépense déjà en base (§8). */
export interface DuplicateCandidate {
  existingExpenseId: Id;
  importedRowNumber: number;
  reason: string;
  confidence: DuplicateConfidence;
}

/** Ligne candidate extraite d'un PDF (§5). */
export interface PdfExtractedLine {
  rawText: string;
  parsedDate: string | null;
  parsedAmount: string | null;
  parsedDescription: string | null;
  confidence: PdfLineConfidence;
}

/** Décompte des lignes d'un aperçu, par statut. */
export interface ImportRowCounts {
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
  refund: number;
  skipped: number;
}

/**
 * Aperçu renvoyé par `POST /api/imports/preview`.
 *
 * L'aperçu est conservé côté serveur : la confirmation ne fait jamais confiance
 * aux lignes renvoyées par le client (§2).
 */
export interface ImportPreviewDto {
  importId: Id;
  sourceType: ImportSourceType;
  filename: string | null;
  /** Encodage détecté (CSV uniquement). */
  encoding: string | null;
  /** Séparateur détecté (CSV uniquement). */
  delimiter: CsvDelimiter | null;
  /**
   * `true` si plusieurs séparateurs produisent une structure plausible : le
   * client doit demander confirmation plutôt que de laisser deviner (§4.2).
   */
  delimiterAmbiguous: boolean;
  headers: string[] | null;
  mapping: CsvColumnMapping | null;
  /** Ordre de date appliqué, déduit du pays de l'utilisateur (§4.6). */
  dateOrder: DateOrder;
  country: CountryCode;
  defaultCurrency: Currency;
  counts: ImportRowCounts;
  rows: ParsedRow[];
  duplicates: DuplicateCandidate[];
  /** Clés i18n des avertissements à afficher (message de compatibilité PDF…). */
  warningKeys: string[];
  expiresAt: IsoDateTimeString;
}

/** Projection d'un `ExpenseImportBatch`. */
export interface ImportBatchDto {
  id: Id;
  sourceType: ImportSourceType;
  filename: string | null;
  rowCount: number;
  importedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  createdAt: IsoDateTimeString;
  rolledBackAt: IsoDateTimeString | null;
  /** Nombre de dépenses encore rattachées au lot (0 après annulation). */
  expenseCount: number;
}

export interface ImportConfirmResultDto {
  batch: ImportBatchDto;
  /** Lignes demandées par le client mais refusées par le serveur, avec le motif. */
  rejectedRows: ParsedRow[];
}

export interface ImportRollbackResultDto {
  batch: ImportBatchDto;
  deletedExpenseCount: number;
}
