import { z } from 'zod';

import {
  EXPENSE_CATEGORIES,
  EXPENSE_FREQUENCIES,
  EXPENSE_SOURCES,
  EXPENSE_STATUSES,
  PAYMENT_METHODS,
} from '../constants/enums';
import { idSchema, isoDateTimeSchema, positiveMoneySchema } from './common';

export const expenseFrequencySchema = z.enum(EXPENSE_FREQUENCIES);
export const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);
export const expenseStatusSchema = z.enum(EXPENSE_STATUSES);
export const expenseSourceSchema = z.enum(EXPENSE_SOURCES);
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

const merchantLabelSchema = z.string().trim().min(1).max(200);

/**
 * Création d'une dépense (schéma §4).
 *
 * `userId` n'apparaît jamais dans un payload client : il provient toujours de
 * la session vérifiée par `requireUser()` (CLAUDE.md §5.3 et §5.14).
 * `amount` est strictement positif ; un remboursement est traité par le
 * pipeline d'import, pas par un montant négatif.
 */
export const createExpenseSchema = z.object({
  merchantRaw: merchantLabelSchema,
  merchantNormalized: merchantLabelSchema,
  merchantOverride: merchantLabelSchema.nullish(),
  amount: positiveMoneySchema,
  date: isoDateTimeSchema,
  frequency: expenseFrequencySchema.default('ONCE'),
  category: expenseCategorySchema.default('OTHER'),
  paymentMethod: paymentMethodSchema.nullish(),
  notes: z.string().trim().max(500).nullish(),
  status: expenseStatusSchema.default('ACTIVE'),
  /** `IMPORT` (CSV/PDF) ou `MANUAL` (correction, espèces, ligne absente du relevé). */
  source: expenseSourceSchema.default('IMPORT'),
  importBatchId: idSchema.nullish(),
});

/** Mise à jour d'une dépense : champs corrigibles manuellement uniquement. */
export const updateExpenseSchema = z
  .object({
    merchantOverride: merchantLabelSchema.nullish(),
    amount: positiveMoneySchema,
    date: isoDateTimeSchema,
    frequency: expenseFrequencySchema,
    category: expenseCategorySchema,
    paymentMethod: paymentMethodSchema.nullish(),
    notes: z.string().trim().max(500).nullish(),
    status: expenseStatusSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'NO_FIELD_PROVIDED');

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
