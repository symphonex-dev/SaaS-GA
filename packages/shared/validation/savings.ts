import { z } from 'zod';

import { GOAL_STATUSES } from '../constants/enums';
import { nonNegativeMoneySchema, positiveMoneySchema } from './common';

export const goalStatusSchema = z.enum(GOAL_STATUSES);

/**
 * Écriture d'un `UserSavingsGoal` (schéma §8).
 *
 * Contraintes applicatives : `targetAmount > 0`,
 * `0 <= achievedAmount <= targetAmount`, et même devise pour les deux montants.
 * Le passage automatique à `REACHED` est décidé côté serveur.
 */
export const createSavingsGoalSchema = z.object({
  targetAmount: positiveMoneySchema,
});

export const updateSavingsGoalSchema = z
  .object({
    targetAmount: positiveMoneySchema,
    achievedAmount: nonNegativeMoneySchema,
    status: goalStatusSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'NO_FIELD_PROVIDED')
  .refine(
    (value) =>
      value.targetAmount == null ||
      value.achievedAmount == null ||
      value.targetAmount.currency === value.achievedAmount.currency,
    'GOAL_CURRENCY_MISMATCH',
  )
  .refine(
    (value) =>
      value.targetAmount == null ||
      value.achievedAmount == null ||
      BigInt(value.achievedAmount.minorUnits) <= BigInt(value.targetAmount.minorUnits),
    'ACHIEVED_AMOUNT_EXCEEDS_TARGET',
  );

export type CreateSavingsGoalInput = z.infer<typeof createSavingsGoalSchema>;
export type UpdateSavingsGoalInput = z.infer<typeof updateSavingsGoalSchema>;
