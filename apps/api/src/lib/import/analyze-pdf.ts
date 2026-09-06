import {
  ERROR_CODES,
  IMPORT_ROW_ERROR_CODES,
  type ParsedRow,
  type PdfExtractedLine,
} from '@subscription-manager/shared';

import { AppError } from '@/lib/api/errors';
import { extractPdfText, toCandidateLines, PdfExtractionError } from '@/lib/pdf/extract';
import { classifyPdfLine, isTransactionCandidate } from '@/lib/pdf/line-classifier';

import { analyzeRow, usesSignedAmounts, type RowAnalysisContext } from './analyze';

/**
 * Pipeline PDF (`specs/import-releves.md` §5).
 *
 * Extraction serveur → segmentation en lignes candidates → classification →
 * score de confiance → analyse avec les mêmes règles de validation que le CSV.
 *
 * Une ligne de faible confiance n'est jamais insérée telle quelle : elle est
 * marquée `INVALID` avec le code `PDF_LOW_CONFIDENCE_LINE` et attend une
 * correction explicite de l'utilisateur.
 */
export interface PdfAnalysisOptions {
  maxPages: number;
  context: RowAnalysisContext;
}

export interface PdfAnalysis {
  pageCount: number;
  /** Lignes classifiées, conservées pour permettre une ré-analyse à la confirmation. */
  lines: PdfExtractedLine[];
  rowNumbers: number[];
  rows: ParsedRow[];
}

export async function analyzePdf(
  content: Buffer,
  options: PdfAnalysisOptions,
): Promise<PdfAnalysis> {
  let extraction;

  try {
    extraction = await extractPdfText(content);
  } catch (error) {
    if (error instanceof PdfExtractionError) {
      throw new AppError(
        ERROR_CODES.IMPORT_FILE_INVALID,
        'PDF illisible : structure non exploitable, document protégé, ou relevé scanné sans couche texte.',
        'file',
      );
    }

    throw error;
  }

  if (extraction.pageCount > options.maxPages) {
    throw new AppError(
      ERROR_CODES.IMPORT_FILE_TOO_MANY_PAGES,
      `Trop de pages (${String(extraction.pageCount)} > ${String(options.maxPages)}).`,
      'file',
    );
  }

  const candidates = toCandidateLines(extraction.pages).filter(isTransactionCandidate);

  if (candidates.length === 0) {
    throw new AppError(
      ERROR_CODES.IMPORT_FILE_INVALID,
      'Aucune ligne de transaction identifiable dans ce PDF.',
      'file',
    );
  }

  const lines = candidates.map((line) =>
    classifyPdfLine(line, {
      dateOrder: options.context.dateOrder,
      decimalHint: options.context.decimalHint,
    }),
  );

  const rowNumbers = lines.map((_line, index) => index + 1);

  return {
    pageCount: extraction.pageCount,
    lines,
    rowNumbers,
    rows: linesToRows(lines, rowNumbers, options.context),
  };
}

/** Ré-analyse des lignes déjà extraites, sans le fichier source. */
export function linesToRows(
  lines: readonly PdfExtractedLine[],
  rowNumbers: readonly number[],
  context: RowAnalysisContext,
): ParsedRow[] {
  const signedAmounts = usesSignedAmounts(
    lines.map((line) => line.parsedAmount ?? '').filter((amount) => amount.length > 0),
  );

  return lines.map((line, index) => {
    const rowNumber = rowNumbers[index] ?? index + 1;

    const row = analyzeRow(
      {
        rowNumber,
        raw: { text: line.rawText, confidence: line.confidence },
        date: line.parsedDate ?? '',
        amount: line.parsedAmount ?? '',
        description: line.parsedDescription ?? '',
        ...(line.confidence === 'LOW'
          ? {
              initialErrors: [
                {
                  code: IMPORT_ROW_ERROR_CODES.PDF_LOW_CONFIDENCE_LINE,
                  message: 'Ligne extraite avec une confiance faible : vérification requise.',
                },
              ],
            }
          : {}),
      },
      context,
      signedAmounts,
    );

    return row;
  });
}
