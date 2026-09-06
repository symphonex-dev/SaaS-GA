import {
  IMPORT_ROW_ERROR_CODES,
  SUPPORTED_CURRENCIES,
  type Currency,
  type DateOrder,
  type DuplicateCandidate,
  type ImportRowError,
  type ParsedRow,
  type TransactionDirection,
} from '@subscription-manager/shared';

import { parseMoney, type DecimalSeparatorHint } from '@/lib/csv/amount';
import { parseCsvDate } from '@/lib/csv/date';
import { findInFileDuplicates, findRefunds, type ImportedRow } from '@/lib/csv/duplicate';
import {
  absoluteMinorUnits,
  decimalStringToMinorUnits,
  minorUnitsToDecimalString,
} from '@/lib/finance/money';
import { normalizeMerchant } from '@/lib/merchant/normalize';

import { neutralizeFormula } from './file-guard';

/**
 * Construction et qualification des lignes d'un import
 * (`specs/import-releves.md` §4, §6, §7, §8).
 *
 * Fonctions pures : mêmes entrées → mêmes sorties, aucune dépendance à la base
 * ni au réseau. La confrontation aux dépenses déjà enregistrées est réalisée
 * séparément, par le service, avec des données filtrées par `userId`.
 */
export interface RowAnalysisContext {
  dateOrder: DateOrder;
  decimalHint: DecimalSeparatorHint;
  defaultCurrency: Currency;
}

/** Valeurs brutes d'une ligne, quelle que soit sa provenance (CSV ou PDF). */
export interface RawRowInput {
  rowNumber: number;
  raw: Record<string, string>;
  date: string;
  amount: string;
  description: string;
  currency?: string;
  /** Sens imposé par la structure du fichier (colonnes débit/crédit séparées). */
  forcedDirection?: TransactionDirection;
  /** Erreurs déjà constatées en amont (ligne PDF de faible confiance). */
  initialErrors?: ImportRowError[];
}

function error(code: ImportRowError['code'], message: string, field?: string): ImportRowError {
  return field === undefined ? { code, message } : { code, message, field };
}

function isSupportedCurrencyCode(value: string): value is Currency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Analyse une ligne brute et produit son statut.
 *
 * `signedAmounts` indique si le fichier utilise le signe du montant pour porter
 * le sens du mouvement. Déterminé une fois pour tout le fichier : un relevé
 * dont tous les montants sont positifs est un relevé de dépenses, un relevé
 * comportant des montants négatifs porte le sens dans le signe (§6).
 */
export function analyzeRow(
  input: RawRowInput,
  context: RowAnalysisContext,
  signedAmounts: boolean,
): ParsedRow {
  const errors: ImportRowError[] = [...(input.initialErrors ?? [])];

  const description = input.description.trim();

  if (description.length === 0) {
    errors.push(
      error(IMPORT_ROW_ERROR_CODES.CSV_MISSING_DESCRIPTION, 'Libellé absent.', 'description'),
    );
  }

  const dateResult = parseCsvDate(input.date, context.dateOrder);

  if (!dateResult.ok) {
    const code =
      dateResult.reason === 'MISSING'
        ? IMPORT_ROW_ERROR_CODES.CSV_MISSING_DATE
        : dateResult.reason === 'AMBIGUOUS'
          ? IMPORT_ROW_ERROR_CODES.CSV_AMBIGUOUS_DATE
          : IMPORT_ROW_ERROR_CODES.CSV_INVALID_DATE;

    errors.push(error(code, `Date inexploitable : « ${input.date} ».`, 'date'));
  }

  const currencyCode = (input.currency ?? '').trim().toUpperCase();
  let currency: Currency = context.defaultCurrency;

  if (currencyCode.length > 0) {
    if (isSupportedCurrencyCode(currencyCode)) {
      currency = currencyCode;
    } else {
      errors.push(
        error(
          IMPORT_ROW_ERROR_CODES.CSV_INVALID_CURRENCY,
          `Devise non supportée : « ${currencyCode} ».`,
          'currency',
        ),
      );
    }
  }

  const amountText = input.amount.trim();
  let amountMinorUnits: bigint | null = null;
  let direction: TransactionDirection = input.forcedDirection ?? 'DEBIT';

  if (amountText.length === 0) {
    errors.push(error(IMPORT_ROW_ERROR_CODES.CSV_MISSING_AMOUNT, 'Montant absent.', 'amount'));
  } else {
    const money = parseMoney(amountText, context.decimalHint);

    if (money === null) {
      errors.push(
        error(
          IMPORT_ROW_ERROR_CODES.CSV_INVALID_AMOUNT,
          `Montant inexploitable : « ${amountText} ».`,
          'amount',
        ),
      );
    } else {
      const minorUnits = decimalStringToMinorUnits(money.value, currency);

      if (minorUnits === null || minorUnits === 0n) {
        errors.push(
          error(
            IMPORT_ROW_ERROR_CODES.CSV_INVALID_AMOUNT,
            minorUnits === 0n
              ? 'Montant nul.'
              : `Montant hors du format de la devise ${currency} : « ${amountText} ».`,
            'amount',
          ),
        );
      } else {
        amountMinorUnits = minorUnits;

        if (input.forcedDirection === undefined) {
          direction = signedAmounts && money.sign === 'positive' ? 'CREDIT' : 'DEBIT';
        }
      }
    }
  }

  const sanitizedRaw = Object.fromEntries(
    Object.entries(input.raw).map(([key, value]) => [key, neutralizeFormula(value)]),
  );

  if (errors.length > 0 || amountMinorUnits === null || !dateResult.ok) {
    return { rowNumber: input.rowNumber, status: 'INVALID', raw: sanitizedRaw, errors };
  }

  const merchant = normalizeMerchant(description);

  return {
    rowNumber: input.rowNumber,
    status: 'VALID',
    raw: sanitizedRaw,
    parsed: {
      merchantRaw: description,
      merchantNormalized: merchant.normalized,
      amount: absoluteDecimal(amountMinorUnits, currency),
      currency,
      date: dateResult.date.iso,
      direction,
    },
    errors,
  };
}

/** Montant toujours positif : le sens est porté par `direction`, jamais par le signe. */
function absoluteDecimal(minorUnits: bigint, currency: Currency): string {
  return minorUnitsToDecimalString(absoluteMinorUnits(minorUnits), currency);
}

/** Convertit les lignes exploitables en éléments comparables (doublons, remboursements). */
export function toComparableRows(rows: readonly ParsedRow[]): ImportedRow[] {
  return rows
    .filter((row) => row.status === 'VALID' && row.parsed !== undefined)
    .map((row) => {
      const parsed = row.parsed as NonNullable<ParsedRow['parsed']>;
      const minorUnits = decimalStringToMinorUnits(parsed.amount, parsed.currency) ?? 0n;

      return {
        rowNumber: row.rowNumber,
        amountMinorUnits: minorUnits < 0n ? -minorUnits : minorUnits,
        currency: parsed.currency,
        date: parsed.date,
        merchantNormalized: parsed.merchantNormalized,
        direction: parsed.direction,
      };
    });
}

/**
 * Applique les règles transverses au fichier, dans un ordre déterministe :
 * remboursements, crédits non pertinents, doublons internes au fichier, puis
 * doublons avec les dépenses déjà enregistrées.
 */
export function applyCrossRowRules(
  rows: ParsedRow[],
  existingDuplicates: readonly DuplicateCandidate[],
): ParsedRow[] {
  const comparable = toComparableRows(rows);
  const byRowNumber = new Map(rows.map((row) => [row.rowNumber, row]));

  // 1. Remboursements : crédit rapproché d'un débit du même import (§6).
  for (const refund of findRefunds(comparable)) {
    const row = byRowNumber.get(refund.creditRowNumber);

    if (row !== undefined && row.status === 'VALID') {
      row.status = 'REFUND';
      row.errors = [
        ...row.errors,
        error(
          IMPORT_ROW_ERROR_CODES.CSV_REFUND,
          `Remboursement rapproché de la ligne ${String(refund.debitRowNumber)} : exclu des dépenses.`,
        ),
      ];
    }
  }

  // 2. Crédits restants : ni dépense, ni remboursement identifié. Ils ne sont
  //    pas convertis en dépense négative (§6), simplement écartés.
  for (const row of rows) {
    if (row.status === 'VALID' && row.parsed?.direction === 'CREDIT') {
      row.status = 'SKIPPED';
    }
  }

  // 3. Doublons internes au fichier.
  for (const rowNumber of findInFileDuplicates(toComparableRows(rows))) {
    const row = byRowNumber.get(rowNumber);

    if (row !== undefined && row.status === 'VALID') {
      row.status = 'DUPLICATE';
      row.errors = [
        ...row.errors,
        error(
          IMPORT_ROW_ERROR_CODES.CSV_DUPLICATE,
          'Ligne identique à une autre ligne du même fichier.',
        ),
      ];
    }
  }

  // 4. Doublons avec les dépenses déjà enregistrées.
  for (const candidate of existingDuplicates) {
    const row = byRowNumber.get(candidate.importedRowNumber);

    if (row !== undefined && row.status === 'VALID') {
      row.status = 'DUPLICATE';
      row.errors = [
        ...row.errors,
        error(
          IMPORT_ROW_ERROR_CODES.CSV_DUPLICATE,
          candidate.confidence === 'HIGH'
            ? 'Dépense déjà enregistrée : exclue de l’import.'
            : 'Dépense probablement déjà enregistrée : à arbitrer.',
        ),
      ];
    }
  }

  return rows;
}

/** Détermine si le fichier porte le sens du mouvement dans le signe du montant. */
export function usesSignedAmounts(amounts: readonly string[]): boolean {
  return amounts.some((amount) => {
    const money = parseMoney(amount);

    return money !== null && money.sign === 'negative';
  });
}

/** Cellule d'une ligne, jamais `undefined` (colonnes manquantes tolérées). */
export function cellAt(cells: readonly string[], index: number | undefined): string {
  if (index === undefined) {
    return '';
  }

  return cells[index] ?? '';
}

/** Reconstruit la représentation brute d'une ligne CSV, indexée par en-tête. */
export function rawRecord(
  cells: readonly string[],
  headers: readonly string[] | null,
): Record<string, string> {
  const record: Record<string, string> = {};

  cells.forEach((cell, index) => {
    const key = headers?.[index];
    record[key !== undefined && key.trim().length > 0 ? key : `column_${String(index)}`] = cell;
  });

  return record;
}
