import {
  ERROR_CODES,
  type CsvColumnMapping,
  type CsvDelimiter,
  type ParsedRow,
} from '@subscription-manager/shared';

import { AppError } from '@/lib/api/errors';
import { decodeCsvBuffer, type CsvEncoding } from '@/lib/csv/encoding';
import { detectDelimiter } from '@/lib/csv/delimiter';
import { detectMapping, looksLikeHeaderRow } from '@/lib/csv/mapping';
import { isEmptyRow, parseCsv } from '@/lib/csv/parser';

import {
  analyzeRow,
  cellAt,
  rawRecord,
  usesSignedAmounts,
  type RowAnalysisContext,
} from './analyze';
import { assertNoActiveContent } from './file-guard';

/**
 * Pipeline CSV complet (`specs/import-releves.md` §4).
 *
 * Enchaînement : détection d'encodage → détection du séparateur → parsing →
 * mapping des colonnes → analyse ligne à ligne. Chaque étape est explicite et
 * peut être surchargée par l'utilisateur (séparateur, mapping, ordre de date) :
 * rien n'est deviné silencieusement.
 */
export interface CsvAnalysisOptions {
  maxRows: number;
  context: RowAnalysisContext;
  /** Séparateur imposé par l'utilisateur après une détection ambiguë. */
  delimiter?: CsvDelimiter;
  /** Mapping imposé par l'utilisateur. */
  mapping?: CsvColumnMapping;
}

export interface CsvAnalysis {
  encoding: CsvEncoding;
  delimiter: CsvDelimiter;
  delimiterAmbiguous: boolean;
  headers: string[] | null;
  mapping: CsvColumnMapping;
  /** Cellules brutes conservées pour permettre un remapping à la confirmation. */
  cells: string[][];
  /** Numéro de ligne (dans le fichier) associé à chaque entrée de `cells`. */
  rowNumbers: number[];
  rows: ParsedRow[];
}

export function analyzeCsv(content: Buffer, options: CsvAnalysisOptions): CsvAnalysis {
  const { encoding, text } = decodeCsvBuffer(content);

  assertNoActiveContent(text);

  if (text.trim().length === 0) {
    throw new AppError(ERROR_CODES.IMPORT_FILE_INVALID, 'Fichier CSV vide.', 'file');
  }

  const detection = detectDelimiter(text);
  const delimiter = options.delimiter ?? detection?.delimiter;

  if (delimiter === undefined) {
    throw new AppError(
      ERROR_CODES.IMPORT_FILE_INVALID,
      'Aucun séparateur exploitable détecté : le fichier ne comporte pas de colonnes.',
      'file',
    );
  }

  // Ambiguïté non tranchée par l'utilisateur : on demande, on ne devine pas (§4.2).
  if (options.delimiter === undefined && detection?.ambiguous === true) {
    throw new AppError(
      ERROR_CODES.IMPORT_DELIMITER_AMBIGUOUS,
      `Séparateur ambigu (candidats : ${detection.candidates.join(' ')}). Confirmez le séparateur.`,
      'delimiter',
    );
  }

  const parsed = parseCsv(text, delimiter);

  if (parsed.unterminatedQuote) {
    throw new AppError(
      ERROR_CODES.IMPORT_FILE_INVALID,
      'Champ entre guillemets non refermé : fichier CSV malformé.',
      'file',
    );
  }

  const allRows = parsed.rows.filter((row) => !isEmptyRow(row));

  if (allRows.length === 0) {
    throw new AppError(ERROR_CODES.IMPORT_FILE_INVALID, 'Fichier CSV sans ligne.', 'file');
  }

  const firstRow = allRows[0] ?? [];
  const hasHeader = looksLikeHeaderRow(firstRow);
  const headers = hasHeader ? firstRow : null;
  const dataRows = hasHeader ? allRows.slice(1) : allRows;

  if (dataRows.length === 0) {
    throw new AppError(
      ERROR_CODES.IMPORT_FILE_INVALID,
      'Fichier CSV sans ligne de données.',
      'file',
    );
  }

  if (dataRows.length > options.maxRows) {
    throw new AppError(
      ERROR_CODES.IMPORT_FILE_TOO_MANY_ROWS,
      `Trop de lignes (${String(dataRows.length)} > ${String(options.maxRows)}).`,
      'file',
    );
  }

  const mapping = options.mapping ?? resolveMapping(headers, firstRow.length);

  // Le sens porté par le signe est déterminé sur l'ensemble du fichier (§6).
  const amountCells = dataRows.map((cells) => cellAt(cells, mapping.amountColumn));
  const signedAmounts = usesSignedAmounts(amountCells);

  // Numérotation dans le fichier : la ligne 1 est l'en-tête lorsqu'il existe.
  const offset = hasHeader ? 2 : 1;

  const rows = dataRows.map((cells, index) =>
    analyzeRow(
      toRawRowInput(cells, headers, mapping, index + offset),
      options.context,
      signedAmounts,
    ),
  );

  return {
    encoding,
    delimiter,
    delimiterAmbiguous: detection?.ambiguous ?? false,
    headers,
    mapping,
    cells: dataRows,
    rowNumbers: dataRows.map((_cells, index) => index + offset),
    rows,
  };
}

/**
 * Ré-analyse des cellules déjà parsées, sans le fichier source (supprimé après
 * l'aperçu). Utilisé quand l'utilisateur corrige le mapping ou l'ordre des
 * dates au moment de la confirmation.
 */
export function reanalyzeCsvCells(
  cells: readonly string[][],
  rowNumbers: readonly number[],
  headers: readonly string[] | null,
  mapping: CsvColumnMapping,
  context: RowAnalysisContext,
): ParsedRow[] {
  const signedAmounts = usesSignedAmounts(cells.map((row) => cellAt(row, mapping.amountColumn)));

  return cells.map((row, index) =>
    analyzeRow(
      toRawRowInput(row, headers, mapping, rowNumbers[index] ?? index + 1),
      context,
      signedAmounts,
    ),
  );
}

function toRawRowInput(
  cells: readonly string[],
  headers: readonly string[] | null,
  mapping: CsvColumnMapping,
  rowNumber: number,
): Parameters<typeof analyzeRow>[0] {
  const debit = cellAt(cells, mapping.debitColumn).trim();
  const credit = cellAt(cells, mapping.creditColumn).trim();

  // Colonnes débit/crédit séparées : le sens vient de la colonne remplie, jamais
  // du signe — un débit y est presque toujours écrit en positif.
  const hasSplitColumns = mapping.debitColumn !== undefined || mapping.creditColumn !== undefined;

  const amount = hasSplitColumns
    ? debit.length > 0
      ? debit
      : credit
    : cellAt(cells, mapping.amountColumn);

  const forcedDirection = hasSplitColumns
    ? debit.length > 0
      ? ('DEBIT' as const)
      : ('CREDIT' as const)
    : undefined;

  return {
    rowNumber,
    raw: rawRecord(cells, headers),
    date: cellAt(cells, mapping.dateColumn),
    amount,
    description: cellAt(cells, mapping.descriptionColumn),
    currency: cellAt(cells, mapping.currencyColumn),
    ...(forcedDirection === undefined ? {} : { forcedDirection }),
  };
}

/**
 * Sans en-tête exploitable, l'utilisateur doit désigner les colonnes lui-même :
 * `IMPORT_MAPPING_REQUIRED` porte la liste des colonnes manquantes (§4.4, §12).
 */
function resolveMapping(headers: string[] | null, columnCount: number): CsvColumnMapping {
  if (headers === null) {
    throw new AppError(
      ERROR_CODES.IMPORT_MAPPING_REQUIRED,
      `Aucun en-tête reconnu sur ${String(columnCount)} colonnes : indiquez les colonnes date, libellé et montant.`,
      'mapping',
    );
  }

  const detected = detectMapping(headers);

  if (detected.mapping === null) {
    throw new AppError(
      ERROR_CODES.IMPORT_MAPPING_REQUIRED,
      `Colonnes introuvables : ${detected.missing.join(', ')}.`,
      'mapping',
    );
  }

  return detected.mapping;
}
