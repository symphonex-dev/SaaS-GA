import { z } from 'zod';

import { DETECTION_CONFIDENCES, DETECTION_STATUSES } from '../constants/enums';
import { idSchema, nonNegativeMoneySchema } from './common';
import { expenseFrequencySchema } from './expense';

export const detectionConfidenceSchema = z.enum(DETECTION_CONFIDENCES);
export const detectionStatusSchema = z.enum(DETECTION_STATUSES);

/**
 * Écriture d'une `RecurringDetection` (schéma §6).
 *
 * Ce payload n'est jamais construit à partir d'une entrée client : il est
 * produit par le moteur déterministe de `specs/moteur-recurrence.md`
 * (CLAUDE.md §5.5). Le schéma sert de garde-fou à la frontière du repository.
 */
export const createRecurringDetectionSchema = z.object({
  expenseId: idSchema,
  frequency: expenseFrequencySchema,
  confidenceScore: detectionConfidenceSchema,
  status: detectionStatusSchema,
  intervalDays: z.number().int().min(0).max(3660),
  amountVariance: nonNegativeMoneySchema,
});

/**
 * Modification d'une détection par l'utilisateur
 * (`specs/moteur-recurrence.md` §8, `PATCH /api/recurring/:id`).
 *
 * Seule la fréquence est modifiable : le statut découle de l'action appelée
 * (`confirm` → CONFIRMED, `PATCH` → MODIFIED, `reject` → REJECTED) et n'est
 * jamais fourni par le client.
 */
export const modifyRecurringDetectionSchema = z.object({
  frequency: expenseFrequencySchema.exclude(['ONCE']),
});

export type CreateRecurringDetectionInput = z.infer<typeof createRecurringDetectionSchema>;
export type ModifyRecurringDetectionInput = z.infer<typeof modifyRecurringDetectionSchema>;
