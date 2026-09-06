import { z } from 'zod';

import {
  AI_MAX_ANSWER_LENGTH,
  AI_MAX_REFERENCED_EXPENSES,
  AI_TASKS,
  AI_UNCERTAINTY_LEVELS,
} from '../constants/ai';

/**
 * Validation de sortie de l'IA (`specs/comparateur-et-assistant-ia.md` B.7).
 *
 * Aucune sortie de modèle n'atteint l'utilisateur sans avoir traversé ce
 * schéma. Toute sortie invalide est rejetée, journalisée (sans son contenu) et
 * remplacée par une réponse générique sûre.
 */
export const aiResponseSchema = z.object({
  answer: z.string().min(1).max(AI_MAX_ANSWER_LENGTH),
  uncertainty: z.enum(AI_UNCERTAINTY_LEVELS),
  referencedExpenseIds: z.array(z.string()).max(AI_MAX_REFERENCED_EXPENSES),
});

export type AiResponse = z.infer<typeof aiResponseSchema>;

export const aiTaskSchema = z.enum(AI_TASKS);
