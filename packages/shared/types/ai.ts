import type { AiTask, AiUncertainty } from '../constants/ai';
import type { Id, IsoDateTimeString } from './common';
import type { AiQuotaDto } from './user';

/**
 * Réponses de l'assistant IA borné
 * (`specs/comparateur-et-assistant-ia.md` partie B).
 *
 * Le texte affiché a toujours traversé `aiResponseSchema` (B.7). Une sortie
 * hors schéma n'atteint jamais l'utilisateur : elle est remplacée par une
 * réponse générique sûre, signalée par `degraded`.
 */
export interface AiAnswerDto {
  /** L'un des trois usages autorisés (B.2) — la liste est fermée. */
  task: AiTask;
  answer: string;
  uncertainty: AiUncertainty;
  /** Sous-ensemble strict des dépenses transmises dans le contexte (B.5). */
  referencedExpenseIds: Id[];
  /**
   * `true` quand la réponse est le repli statique : provider indisponible ou
   * sortie rejetée par les garde-fous. L'application reste utilisable —
   * l'IA n'est jamais un prérequis fonctionnel (B.3).
   */
  degraded: boolean;
  /** Version du prompt système ayant produit la réponse (B.6). */
  promptVersion: string;
  /** Crédits restants après cet appel (B.8). */
  quota: AiQuotaDto;
  generatedAt: IsoDateTimeString;
}
