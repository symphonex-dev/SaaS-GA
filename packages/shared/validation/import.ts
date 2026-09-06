import { z } from 'zod';

import { CSV_ROW_STATUSES, IMPORT_SOURCE_TYPES } from '../constants/enums';
import { DATE_ORDERS } from '../constants/import';
import { idSchema } from './common';

export const importSourceTypeSchema = z.enum(IMPORT_SOURCE_TYPES);
export const csvRowStatusSchema = z.enum(CSV_ROW_STATUSES);
export const dateOrderSchema = z.enum(DATE_ORDERS);

const countSchema = z.number().int().min(0);
const columnIndexSchema = z.number().int().min(0).max(512);
const rowNumberSchema = z.number().int().min(1).max(1_000_000);

/**
 * Création d'un `ExpenseImportBatch` (schéma §5). Les compteurs sont produits
 * par le pipeline d'import serveur, jamais envoyés par le client.
 */
export const createImportBatchSchema = z
  .object({
    sourceType: importSourceTypeSchema,
    filename: z.string().trim().min(1).max(255).nullish(),
    rowCount: countSchema,
    importedCount: countSchema,
    rejectedCount: countSchema,
    duplicateCount: countSchema,
  })
  .refine(
    (value) => value.importedCount + value.rejectedCount + value.duplicateCount <= value.rowCount,
    'IMPORT_COUNTS_INCONSISTENT',
  );

/** Mapping des colonnes CSV (`specs/import-releves.md` §4.4). */
export const csvColumnMappingSchema = z
  .object({
    dateColumn: columnIndexSchema,
    amountColumn: columnIndexSchema,
    descriptionColumn: columnIndexSchema,
    debitColumn: columnIndexSchema.optional(),
    creditColumn: columnIndexSchema.optional(),
    currencyColumn: columnIndexSchema.optional(),
  })
  .refine(
    (mapping) => mapping.dateColumn !== mapping.descriptionColumn,
    'MAPPING_COLUMNS_MUST_DIFFER',
  );

/**
 * Correction d'une ligne incertaine avant insertion (§5, parcours PDF).
 *
 * Extension du `ConfirmImportInput` de la spec §10 : sans elle, une ligne PDF
 * de faible confiance ne pourrait jamais être corrigée, alors que le flux §5
 * prévoit explicitement cette étape. Les valeurs corrigées repassent par la
 * même validation que les valeurs extraites — jamais insérées telles quelles.
 */
export const importRowCorrectionSchema = z
  .object({
    rowNumber: rowNumberSchema,
    date: z.string().trim().min(1).max(40).optional(),
    amount: z.string().trim().min(1).max(40).optional(),
    description: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (correction) =>
      correction.date !== undefined ||
      correction.amount !== undefined ||
      correction.description !== undefined,
    'CORRECTION_MUST_CHANGE_SOMETHING',
  );

/**
 * Confirmation d'un import (§10).
 *
 * `acceptedRows` est la seule source d'insertion : une ligne absente de cette
 * liste n'est jamais insérée. Le serveur revalide tout — l'aperçu détenu par le
 * client n'est jamais une source de vérité (§2).
 */
export const confirmImportSchema = z
  .object({
    importId: idSchema,
    mapping: csvColumnMappingSchema.optional(),
    /** Ordre de date confirmé/corrigé par l'utilisateur (§4.6). */
    dateOrder: dateOrderSchema.optional(),
    acceptedRows: z.array(rowNumberSchema).max(10_000),
    rejectedRows: z.array(rowNumberSchema).max(10_000).default([]),
    corrections: z.array(importRowCorrectionSchema).max(10_000).default([]),
  })
  .refine((input) => new Set(input.acceptedRows).size === input.acceptedRows.length, {
    message: 'DUPLICATE_ROW_NUMBER',
    path: ['acceptedRows'],
  })
  .refine(
    (input) => {
      const rejected = new Set(input.rejectedRows);
      return input.acceptedRows.every((row) => !rejected.has(row));
    },
    { message: 'ROW_ACCEPTED_AND_REJECTED', path: ['acceptedRows'] },
  );

export type CreateImportBatchInput = z.infer<typeof createImportBatchSchema>;
export type CsvColumnMappingInput = z.infer<typeof csvColumnMappingSchema>;
export type ImportRowCorrectionInput = z.infer<typeof importRowCorrectionSchema>;
export type ConfirmImportInput = z.infer<typeof confirmImportSchema>;
