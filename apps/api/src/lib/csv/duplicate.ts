import {
  REFUND_MATCH_WINDOW_DAYS,
  type Currency,
  type DuplicateCandidate,
  type TransactionDirection,
} from '@subscription-manager/shared';

import { merchantComparisonKey } from '@/lib/merchant/normalize';

/**
 * Détection des doublons et des remboursements
 * (`specs/import-releves.md` §6 et §8).
 *
 * Score entièrement déterministe : même utilisateur + même date + même montant
 * + même devise + commerçant normalisé équivalent. Aucune tolérance
 * financière ; la seule tolérance admise porte sur le format du libellé
 * (casse, accents, ponctuation), via `merchantComparisonKey`.
 */
export interface ComparableTransaction {
  /** Montant en unités mineures, toujours positif. */
  amountMinorUnits: bigint;
  currency: Currency;
  /** Date ISO 8601 (`2026-01-05`). */
  date: string;
  merchantNormalized: string;
  direction: TransactionDirection;
}

export interface ExistingExpense extends ComparableTransaction {
  id: string;
}

export interface ImportedRow extends ComparableTransaction {
  rowNumber: number;
}

/** Tolérance de date d'un doublon probable : le même mouvement peut être daté à un jour près. */
const MEDIUM_CONFIDENCE_DAY_TOLERANCE = 3;

function daysBetween(left: string, right: string): number {
  const leftTime = Date.parse(`${left}T00:00:00.000Z`);
  const rightTime = Date.parse(`${right}T00:00:00.000Z`);

  return Math.abs(leftTime - rightTime) / 86_400_000;
}

function sameMerchant(left: string, right: string): boolean {
  return merchantComparisonKey(left) === merchantComparisonKey(right);
}

/**
 * Compare une ligne importée aux dépenses déjà enregistrées de l'utilisateur.
 *
 * `existing` ne doit contenir que les dépenses de l'utilisateur courant : le
 * filtrage par `userId` est effectué par le repository, jamais ici
 * (CLAUDE.md §5.3). Aucun rapprochement entre utilisateurs n'est donc possible.
 */
export function findDuplicates(
  rows: readonly ImportedRow[],
  existing: readonly ExistingExpense[],
): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];
  const consumedExpenseIds = new Set<string>();

  for (const row of rows) {
    let best: { expense: ExistingExpense; confidence: 'HIGH' | 'MEDIUM'; reason: string } | null =
      null;

    for (const expense of existing) {
      if (consumedExpenseIds.has(expense.id)) {
        continue;
      }

      if (
        expense.currency !== row.currency ||
        expense.amountMinorUnits !== row.amountMinorUnits ||
        !sameMerchant(expense.merchantNormalized, row.merchantNormalized)
      ) {
        continue;
      }

      if (expense.date === row.date) {
        best = {
          expense,
          confidence: 'HIGH',
          reason: 'SAME_DATE_AMOUNT_CURRENCY_MERCHANT',
        };
        break;
      }

      if (daysBetween(expense.date, row.date) <= MEDIUM_CONFIDENCE_DAY_TOLERANCE && best === null) {
        best = {
          expense,
          confidence: 'MEDIUM',
          reason: 'NEAR_DATE_SAME_AMOUNT_CURRENCY_MERCHANT',
        };
      }
    }

    if (best !== null) {
      consumedExpenseIds.add(best.expense.id);
      candidates.push({
        existingExpenseId: best.expense.id,
        importedRowNumber: row.rowNumber,
        reason: best.reason,
        confidence: best.confidence,
      });
    }
  }

  return candidates;
}

export interface RefundMatch {
  /** Ligne de crédit identifiée comme remboursement. */
  creditRowNumber: number;
  /** Ligne de débit correspondante, dans le même import. */
  debitRowNumber: number;
}

/**
 * Rapproche les remboursements (§6) : un crédit du même commerçant, de montant
 * strictement opposé, dans une fenêtre temporelle proche d'un débit.
 *
 * Un crédit n'est jamais converti automatiquement en dépense négative : il est
 * marqué `REFUND` et exclu de l'insertion, donc du total des dépenses et de
 * l'historique utilisé par le moteur de récurrence.
 */
export function findRefunds(rows: readonly ImportedRow[]): RefundMatch[] {
  const debits = rows.filter((row) => row.direction === 'DEBIT');
  const matches: RefundMatch[] = [];
  const consumedDebits = new Set<number>();

  for (const credit of rows) {
    if (credit.direction !== 'CREDIT') {
      continue;
    }

    const match = debits.find(
      (debit) =>
        !consumedDebits.has(debit.rowNumber) &&
        debit.currency === credit.currency &&
        debit.amountMinorUnits === credit.amountMinorUnits &&
        sameMerchant(debit.merchantNormalized, credit.merchantNormalized) &&
        daysBetween(debit.date, credit.date) <= REFUND_MATCH_WINDOW_DAYS,
    );

    if (match !== undefined) {
      consumedDebits.add(match.rowNumber);
      matches.push({ creditRowNumber: credit.rowNumber, debitRowNumber: match.rowNumber });
    }
  }

  return matches;
}

/**
 * Doublons internes au fichier : deux lignes identiques dans le même import.
 * Renvoie les numéros des lignes en double (la première occurrence est conservée).
 */
export function findInFileDuplicates(rows: readonly ImportedRow[]): number[] {
  const seen = new Set<string>();
  const duplicates: number[] = [];

  for (const row of rows) {
    const key = [
      row.date,
      row.amountMinorUnits.toString(),
      row.currency,
      row.direction,
      merchantComparisonKey(row.merchantNormalized),
    ].join('|');

    if (seen.has(key)) {
      duplicates.push(row.rowNumber);
      continue;
    }

    seen.add(key);
  }

  return duplicates;
}
