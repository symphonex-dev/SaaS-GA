import {
  ERROR_CODES,
  PDF_COMPATIBILITY_NOTICE_KEY,
  dateOrderForCountry,
  type AuthenticatedUser,
  type ConfirmImportInput,
  type CsvColumnMapping,
  type CsvDelimiter,
  type DateOrder,
  type DuplicateCandidate,
  type ImportBatchDto,
  type ImportConfirmResultDto,
  type ImportPreviewDto,
  type ImportRollbackResultDto,
  type ImportRowCounts,
  type ParsedRow,
  type PdfExtractedLine,
} from '@subscription-manager/shared';
import type { ExpenseImportBatch } from '@prisma/client';

import { AppError } from '@/lib/api/errors';
import { decimalHintForCountry } from '@/lib/csv/amount';
import { isoDateToUtcDate } from '@/lib/csv/date';
import { findDuplicates, type ExistingExpense } from '@/lib/csv/duplicate';
import { getServerEnv } from '@/lib/env/server';
import { decimalStringToMinorUnits } from '@/lib/finance/money';
import {
  applyCrossRowRules,
  toComparableRows,
  type RowAnalysisContext,
} from '@/lib/import/analyze';
import { analyzeCsv, reanalyzeCsvCells } from '@/lib/import/analyze-csv';
import { analyzePdf, linesToRows } from '@/lib/import/analyze-pdf';
import { assertFileSize, resolveSourceType, type UploadedFile } from '@/lib/import/file-guard';
import { withTemporaryFile, readTemporaryFile } from '@/lib/import/temp-file';
import {
  FREE_PDF_TRIAL_IMPORTS,
  effectivePlan,
  getEntitlements,
} from '@/server/entitlements/entitlements';
import {
  consumePreview,
  createPreviewId,
  getPreview,
  storePreview,
  type StoredPreview,
} from '@/server/import/preview-store';
import { importRepository } from '@/server/repositories/import.repository';
import { recurringDetectionService } from '@/server/services/recurring-detection.service';
import { subscriptionRepository } from '@/server/repositories/subscription.repository';

/**
 * Service d'import de relevés (`specs/import-releves.md`).
 *
 * C'est le parcours principal de création de dépenses (CLAUDE.md §1, §5.4).
 * Invariants tenus ici :
 *  - le fichier source est supprimé immédiatement après traitement, dans un
 *    bloc `finally`, y compris en cas d'erreur (§3, §11) ;
 *  - la confirmation revalide toujours : l'aperçu détenu par le client n'est
 *    jamais une source de vérité (§2) ;
 *  - aucune ligne invalide n'est insérée silencieusement (§7) ;
 *  - toute lecture et toute écriture est filtrée par `userId` (CLAUDE.md §5.3).
 */
export interface PreviewOptions {
  /** Séparateur confirmé par l'utilisateur après une détection ambiguë. */
  delimiter?: CsvDelimiter;
  /** Mapping imposé par l'utilisateur quand les en-têtes ne suffisent pas. */
  mapping?: CsvColumnMapping;
  /** Ordre de date choisi par l'utilisateur ; sinon déduit de son pays. */
  dateOrder?: DateOrder;
}

/** Fenêtre de recherche des doublons autour des dates importées, en jours. */
const DUPLICATE_LOOKUP_MARGIN_DAYS = 7;

function analysisContext(user: AuthenticatedUser, dateOrder: DateOrder): RowAnalysisContext {
  return {
    dateOrder,
    decimalHint: decimalHintForCountry(user.country),
    defaultCurrency: user.currency,
  };
}

/**
 * Offre en vigueur.
 *
 * Résolution centralisée (`specs/paiement-in-app.md` §7) : un abonnement
 * résilié conserve ses droits jusqu'à `currentPeriodEnd`, un abonnement
 * suspendu ou échu n'en a plus.
 */
async function planForUser(userId: string): Promise<'FREE' | 'PLUS'> {
  return effectivePlan(await subscriptionRepository.findByUserId(userId));
}

/**
 * Contrôle des droits (`specs/import-releves.md` §5,
 * `specs/paiement-in-app.md` §2 et §7).
 *
 * Le PDF est réservé à Plus, avec un essai très limité en Free ; le CSV est
 * plafonné par mois en Free. Contrôle exclusivement serveur.
 */
async function assertImportAllowed(userId: string, sourceType: 'CSV' | 'PDF'): Promise<void> {
  const entitlements = getEntitlements(await planForUser(userId));

  if (sourceType === 'PDF') {
    if (entitlements.pdfImportEnabled) {
      return;
    }

    const pdfImports = await importRepository.countBatchesForUser(userId, { sourceType: 'PDF' });

    if (pdfImports >= FREE_PDF_TRIAL_IMPORTS) {
      throw new AppError(
        ERROR_CODES.IMPORT_PDF_REQUIRES_PLUS,
        "L'import PDF est réservé à l'offre Plus au-delà de l'essai gratuit.",
      );
    }

    return;
  }

  const monthlyLimit = entitlements.maxCsvImportsPerMonth;

  if (monthlyLimit === null) {
    return;
  }

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const imports = await importRepository.countBatchesForUser(userId, {
    sourceType: 'CSV',
    createdAfter: startOfMonth,
  });

  if (imports >= monthlyLimit) {
    throw new AppError(
      ERROR_CODES.IMPORT_QUOTA_REACHED,
      "Quota d'imports de l'offre Free atteint pour ce mois.",
    );
  }
}

/**
 * Charge les dépenses de l'utilisateur susceptibles de correspondre aux lignes
 * importées. La requête est bornée par la plus ancienne date importée : inutile
 * de charger tout l'historique.
 */
async function loadExistingExpenses(
  userId: string,
  rows: readonly ParsedRow[],
): Promise<ExistingExpense[]> {
  const dates = rows
    .filter((row) => row.parsed !== undefined)
    .map((row) => row.parsed?.date ?? '')
    .filter((date) => date.length > 0)
    .sort();

  const earliest = dates[0];

  if (earliest === undefined) {
    return [];
  }

  const since = new Date(
    isoDateToUtcDate(earliest).getTime() - DUPLICATE_LOOKUP_MARGIN_DAYS * 86_400_000,
  );

  const expenses = await importRepository.listExpensesForDuplicateCheck(userId, since);

  return expenses.flatMap((expense) => {
    const currency = expense.currency;
    const minorUnits = decimalStringToMinorUnits(expense.amount.toString(), currency as never);

    if (minorUnits === null) {
      return [];
    }

    return [
      {
        id: expense.id,
        amountMinorUnits: minorUnits < 0n ? -minorUnits : minorUnits,
        currency: currency as never,
        date: expense.date.toISOString().slice(0, 10),
        merchantNormalized: expense.merchantNormalized,
        direction: 'DEBIT' as const,
      },
    ];
  });
}

function countRows(rows: readonly ParsedRow[]): ImportRowCounts {
  return {
    total: rows.length,
    valid: rows.filter((row) => row.status === 'VALID').length,
    invalid: rows.filter((row) => row.status === 'INVALID').length,
    duplicate: rows.filter((row) => row.status === 'DUPLICATE').length,
    refund: rows.filter((row) => row.status === 'REFUND').length,
    skipped: rows.filter((row) => row.status === 'SKIPPED').length,
  };
}

/**
 * Une ligne est insérable si elle est valide, ou si c'est un doublon
 * seulement probable (`MEDIUM`) que l'utilisateur a explicitement accepté.
 * Un doublon certain (`HIGH`) n'est jamais insérable (§8).
 */
function isInsertable(row: ParsedRow, duplicates: readonly DuplicateCandidate[]): boolean {
  if (row.parsed === undefined) {
    return false;
  }

  if (row.status === 'VALID') {
    return true;
  }

  if (row.status !== 'DUPLICATE') {
    return false;
  }

  const candidate = duplicates.find((entry) => entry.importedRowNumber === row.rowNumber);

  return candidate !== undefined && candidate.confidence === 'MEDIUM';
}

function toBatchDto(batch: ExpenseImportBatch, expenseCount: number): ImportBatchDto {
  return {
    id: batch.id,
    sourceType: batch.sourceType,
    filename: batch.filename,
    rowCount: batch.rowCount,
    importedCount: batch.importedCount,
    rejectedCount: batch.rejectedCount,
    duplicateCount: batch.duplicateCount,
    createdAt: batch.createdAt.toISOString(),
    rolledBackAt: batch.rolledBackAt?.toISOString() ?? null,
    expenseCount,
  };
}

export const importService = {
  /**
   * Analyse le fichier et renvoie l'aperçu. Le fichier est écrit dans une zone
   * temporaire isolée, relu, puis supprimé dans un bloc `finally` — même si
   * l'analyse échoue (§3, §11).
   */
  async preview(
    user: AuthenticatedUser,
    file: UploadedFile,
    options: PreviewOptions = {},
  ): Promise<ImportPreviewDto> {
    const env = getServerEnv();

    assertFileSize(file.content, env.MAX_IMPORT_FILE_SIZE_BYTES);

    const sourceType = resolveSourceType(file);

    await assertImportAllowed(user.id, sourceType);

    const dateOrder = options.dateOrder ?? dateOrderForCountry(user.country);
    const context = analysisContext(user, dateOrder);

    const analysis = await withTemporaryFile(
      file.content,
      sourceType === 'PDF' ? 'pdf' : 'csv',
      async (filePath) => {
        // Le traitement part systématiquement du fichier écrit sur disque :
        // c'est lui qui est supprimé ensuite, jamais une copie oubliée.
        const content = await readTemporaryFile(filePath);

        if (sourceType === 'PDF') {
          const pdf = await analyzePdf(content, { maxPages: env.MAX_PDF_PAGES, context });

          return { kind: 'PDF' as const, pdf };
        }

        const csv = analyzeCsv(content, {
          maxRows: env.MAX_CSV_ROWS,
          context,
          ...(options.delimiter === undefined ? {} : { delimiter: options.delimiter }),
          ...(options.mapping === undefined ? {} : { mapping: options.mapping }),
        });

        return { kind: 'CSV' as const, csv };
      },
    );

    const rows = analysis.kind === 'CSV' ? analysis.csv.rows : analysis.pdf.rows;
    const existing = await loadExistingExpenses(user.id, rows);
    const duplicates = findDuplicates(toComparableRows(rows), existing);

    applyCrossRowRules(rows, duplicates);

    const stored = await storePreview({
      importId: createPreviewId(),
      userId: user.id,
      sourceType,
      filename: file.filename,
      rows,
      mapping: analysis.kind === 'CSV' ? analysis.csv.mapping : null,
      headers: analysis.kind === 'CSV' ? analysis.csv.headers : null,
      rawCells: analysis.kind === 'CSV' ? analysis.csv.cells : null,
      rawLines: analysis.kind === 'PDF' ? analysis.pdf.lines : null,
      rowNumbers: analysis.kind === 'CSV' ? analysis.csv.rowNumbers : analysis.pdf.rowNumbers,
      dateOrder,
      defaultCurrency: user.currency,
      country: user.country,
    });

    return {
      importId: stored.importId,
      sourceType,
      filename: file.filename,
      encoding: analysis.kind === 'CSV' ? analysis.csv.encoding : null,
      delimiter: analysis.kind === 'CSV' ? analysis.csv.delimiter : null,
      delimiterAmbiguous: analysis.kind === 'CSV' ? analysis.csv.delimiterAmbiguous : false,
      headers: analysis.kind === 'CSV' ? analysis.csv.headers : null,
      mapping: analysis.kind === 'CSV' ? analysis.csv.mapping : null,
      dateOrder,
      country: user.country,
      defaultCurrency: user.currency,
      counts: countRows(rows),
      rows,
      duplicates,
      // Message de compatibilité limitée obligatoire avant tout import PDF (§5).
      warningKeys: sourceType === 'PDF' ? [PDF_COMPATIBILITY_NOTICE_KEY] : [],
      expiresAt: stored.expiresAt.toISOString(),
    };
  },

  /**
   * Confirme un import : ré-analyse complète côté serveur, puis insertion
   * transactionnelle du lot et de ses dépenses (§2, §10).
   */
  async confirm(
    user: AuthenticatedUser,
    input: ConfirmImportInput,
  ): Promise<ImportConfirmResultDto> {
    const preview = await getPreview(input.importId, user.id);

    if (preview === null) {
      throw new AppError(
        ERROR_CODES.IMPORT_PREVIEW_EXPIRED,
        "Aperçu introuvable ou expiré : relancez l'import.",
        'importId',
      );
    }

    // L'aperçu est **réservé avant** toute écriture, pas après : deux
    // confirmations concurrentes du même import passeraient sinon toutes les
    // deux la lecture ci-dessus et créeraient deux lots. Seul l'appel gagnant
    // poursuit ; les autres voient un aperçu déjà consommé.
    if (!(await consumePreview(preview.importId, user.id))) {
      throw new AppError(
        ERROR_CODES.IMPORT_PREVIEW_EXPIRED,
        "Aperçu déjà utilisé : relancez l'import.",
        'importId',
      );
    }

    const dateOrder = input.dateOrder ?? preview.dateOrder;
    const context = analysisContext(user, dateOrder);
    const mapping = input.mapping ?? preview.mapping;

    // Ré-analyse à partir des données brutes conservées : le contenu envoyé par
    // le client n'est jamais réutilisé tel quel.
    const rows = reanalyze(preview, mapping, context, input);

    const existing = await loadExistingExpenses(user.id, rows);
    const duplicates = findDuplicates(toComparableRows(rows), existing);

    applyCrossRowRules(rows, duplicates);

    const accepted = new Set(input.acceptedRows);
    const byRowNumber = new Map(rows.map((row) => [row.rowNumber, row]));

    const insertable: ParsedRow[] = [];
    const refused: ParsedRow[] = [];

    for (const rowNumber of input.acceptedRows) {
      const row = byRowNumber.get(rowNumber);

      if (row === undefined) {
        continue;
      }

      if (isInsertable(row, duplicates)) {
        insertable.push(row);
      } else {
        refused.push(row);
      }
    }

    const duplicateCount = rows.filter(
      (row) => row.status === 'DUPLICATE' && !insertable.includes(row),
    ).length;

    const rejectedCount =
      rows.filter((row) => row.status === 'INVALID').length +
      rows.filter((row) => row.status === 'VALID' && !accepted.has(row.rowNumber)).length;

    const batch = await importRepository.createBatchWithExpenses(
      user.id,
      {
        sourceType: preview.sourceType,
        filename: preview.filename,
        rowCount: rows.length,
        importedCount: insertable.length,
        rejectedCount,
        duplicateCount,
      },
      insertable.map((row) => {
        const parsed = row.parsed as NonNullable<ParsedRow['parsed']>;

        return {
          merchantRaw: parsed.merchantRaw,
          merchantNormalized: parsed.merchantNormalized,
          amount: parsed.amount,
          currency: parsed.currency,
          date: isoDateToUtcDate(parsed.date),
          // La catégorisation et le mode de paiement ne sont jamais devinés à
          // l'import : ils relèvent d'une correction manuelle ou d'une phase
          // ultérieure.
          category: 'OTHER',
          paymentMethod: null,
        };
      }),
    );

    // Détection des récurrences juste après l'import : c'est l'étape suivante du
    // parcours principal (CLAUDE.md §1). Au mieux : un échec ici ne doit pas
    // faire échouer un import déjà enregistré — l'utilisateur relancera.
    try {
      await recurringDetectionService.refreshForUser(user.id);
    } catch (error) {
      console.error(
        'Détection des récurrences impossible après import :',
        error instanceof Error ? error.name : typeof error,
      );
    }

    return {
      batch: toBatchDto(batch, insertable.length),
      rejectedRows: refused,
    };
  },

  async getBatch(user: AuthenticatedUser, batchId: string): Promise<ImportBatchDto> {
    const batch = await importRepository.findBatchForUser(batchId, user.id);

    if (batch === null) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Import introuvable.', 'id');
    }

    const expenseCount = await importRepository.countExpensesInBatch(batch.id, user.id);

    return toBatchDto(batch, expenseCount);
  },

  /**
   * Annule un import (§10) : supprime uniquement les dépenses créées par ce
   * lot. Un lot déjà annulé ne peut pas l'être une seconde fois.
   */
  async rollback(user: AuthenticatedUser, batchId: string): Promise<ImportRollbackResultDto> {
    const batch = await importRepository.findBatchForUser(batchId, user.id);

    if (batch === null) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Import introuvable.', 'id');
    }

    if (batch.rolledBackAt !== null) {
      throw new AppError(
        ERROR_CODES.IMPORT_BATCH_ALREADY_ROLLED_BACK,
        'Cet import a déjà été annulé.',
        'id',
      );
    }

    const deletedExpenseCount = await importRepository.rollbackBatch(batch.id, user.id, new Date());
    const updated = await importRepository.findBatchForUser(batch.id, user.id);

    return {
      batch: toBatchDto(updated ?? batch, 0),
      deletedExpenseCount,
    };
  },
};

/**
 * Rejoue l'analyse à partir des données brutes de l'aperçu, en appliquant le
 * mapping, l'ordre de date et les corrections demandés par l'utilisateur.
 */
function reanalyze(
  preview: StoredPreview,
  mapping: CsvColumnMapping | null,
  context: RowAnalysisContext,
  input: ConfirmImportInput,
): ParsedRow[] {
  if (preview.sourceType === 'CSV') {
    if (mapping === null || preview.rawCells === null) {
      throw new AppError(
        ERROR_CODES.IMPORT_MAPPING_REQUIRED,
        'Mapping des colonnes requis pour confirmer cet import.',
        'mapping',
      );
    }

    const cells = applyCsvCorrections(preview.rawCells, preview.rowNumbers, mapping, input);

    return reanalyzeCsvCells(cells, preview.rowNumbers, preview.headers, mapping, context);
  }

  if (preview.rawLines === null) {
    throw new AppError(
      ERROR_CODES.IMPORT_PREVIEW_EXPIRED,
      "Aperçu incomplet : relancez l'import.",
      'importId',
    );
  }

  const lines = applyPdfCorrections(preview.rawLines, preview.rowNumbers, input);

  return linesToRows(lines, preview.rowNumbers, context);
}

/** Réécrit les cellules corrigées, aux colonnes désignées par le mapping. */
function applyCsvCorrections(
  cells: readonly string[][],
  rowNumbers: readonly number[],
  mapping: CsvColumnMapping,
  input: ConfirmImportInput,
): string[][] {
  if (input.corrections.length === 0) {
    return cells.map((row) => [...row]);
  }

  const byRowNumber = new Map(
    input.corrections.map((correction) => [correction.rowNumber, correction]),
  );

  return cells.map((row, index) => {
    const correction = byRowNumber.get(rowNumbers[index] ?? -1);
    const copy = [...row];

    if (correction === undefined) {
      return copy;
    }

    if (correction.date !== undefined) {
      copy[mapping.dateColumn] = correction.date;
    }

    if (correction.amount !== undefined) {
      copy[mapping.amountColumn] = correction.amount;

      // Une correction de montant remplace la valeur des colonnes débit/crédit
      // séparées, sans quoi l'ancienne valeur continuerait de primer.
      if (mapping.debitColumn !== undefined) {
        copy[mapping.debitColumn] = correction.amount;
      }

      if (mapping.creditColumn !== undefined) {
        copy[mapping.creditColumn] = '';
      }
    }

    if (correction.description !== undefined) {
      copy[mapping.descriptionColumn] = correction.description;
    }

    return copy;
  });
}

/** Applique les corrections de lignes PDF de faible confiance (§5). */
function applyPdfCorrections(
  lines: readonly PdfExtractedLine[],
  rowNumbers: readonly number[],
  input: ConfirmImportInput,
): PdfExtractedLine[] {
  if (input.corrections.length === 0) {
    return [...lines];
  }

  const byRowNumber = new Map(
    input.corrections.map((correction) => [correction.rowNumber, correction]),
  );

  return lines.map((line, index) => {
    const correction = byRowNumber.get(rowNumbers[index] ?? -1);

    if (correction === undefined) {
      return line;
    }

    const corrected: PdfExtractedLine = {
      ...line,
      ...(correction.date === undefined ? {} : { parsedDate: correction.date }),
      ...(correction.amount === undefined ? {} : { parsedAmount: correction.amount }),
      ...(correction.description === undefined
        ? {}
        : { parsedDescription: correction.description }),
    };

    // Une ligne corrigée par l'utilisateur cesse d'être « faible confiance » :
    // ses valeurs restent malgré tout revalidées comme n'importe quelle autre.
    return corrected.parsedDate !== null &&
      corrected.parsedAmount !== null &&
      corrected.parsedDescription !== null
      ? { ...corrected, confidence: 'MEDIUM' }
      : corrected;
  });
}
