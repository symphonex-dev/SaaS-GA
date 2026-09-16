import {
  ERROR_CODES,
  type AiAnswerDto,
  type AiStatusDto,
  type AiTask,
  type AuthenticatedUser,
  type CommercializedPlan,
} from '@subscription-manager/shared';

import { AppError } from '@/lib/api/errors';
import { getServerEnv } from '@/lib/env/server';
import { effectivePlan } from '@/server/entitlements/entitlements';
import { subscriptionRepository } from '@/server/repositories/subscription.repository';

import { buildAiFacts, type AiFacts } from './ai.context';
import { logAiRejection, safeFallbackResponse, validateAiOutput } from './ai.guardrails';
import { buildSystemPrompt, AI_SYSTEM_PROMPT_VERSION } from './ai.prompt';
import { isAiEnabled, resolveAiProvider } from './ai.provider';
import { consumeAiCredit, readAiQuota } from './ai.quota';
import { serializeAiContext } from './ai.redaction';

/**
 * Assistant IA borné (`specs/comparateur-et-assistant-ia.md` partie B).
 *
 * Trois usages, pas un de plus (B.2). Chacun suit exactement la même chaîne :
 *
 *   faits déterministes → rédaction → prompt versionné → provider
 *                       → validation Zod → texte affiché
 *
 * L'IA ne lit ni n'écrit jamais la base : elle reçoit des chiffres déjà
 * calculés et renvoie du texte. Aucune route ne lui permet de déclencher une
 * action (résiliation, suppression, paiement).
 */

/**
 * Offre de l'utilisateur : détermine le nombre de crédits mensuels (B.8).
 *
 * Résolue par `effectivePlan` (`specs/paiement-in-app.md` §7), jamais par le
 * seul champ `plan` : un abonnement suspendu ou échu ne donne plus le quota
 * supérieur, un abonnement résilié le conserve jusqu'à la fin de sa période.
 */
async function planOf(user: AuthenticatedUser, now: Date): Promise<CommercializedPlan> {
  return effectivePlan(await subscriptionRepository.findByUserId(user.id), now);
}

function unavailable(): AppError {
  return new AppError(ERROR_CODES.AI_UNAVAILABLE, 'Assistant indisponible.');
}

/**
 * Exécute l'un des trois usages autorisés.
 *
 * Ordre des opérations, volontaire :
 *  1. vérifier qu'un provider existe — sans quoi aucun crédit n'est consommé
 *     pour une fonctionnalité désactivée ;
 *  2. consommer un crédit **avant** l'appel, par requête conditionnelle
 *     atomique : c'est ce qui rend le quota incontournable, y compris sous
 *     appels concurrents (B.8) ;
 *  3. appeler le provider, puis valider sa sortie.
 *
 * Il n'existe pas de remboursement de crédit : un appel réellement passé au
 * provider est consommé, même si sa sortie est rejetée. Rembourser ouvrirait
 * une boucle d'appels gratuits en provoquant volontairement l'échec.
 */
async function runTask(
  user: AuthenticatedUser,
  task: AiTask,
  now: Date,
  facts?: AiFacts,
): Promise<AiAnswerDto> {
  const provider = resolveAiProvider();

  if (provider === null) {
    throw unavailable();
  }

  const env = getServerEnv();
  const plan = await planOf(user, now);
  const quota = await consumeAiCredit(user.id, plan, now);

  const resolvedFacts = facts ?? (await buildAiFacts(user, now));
  const serializedContext = serializeAiContext(resolvedFacts.context);

  const base = {
    task,
    referencedExpenseIds: [] as string[],
    promptVersion: AI_SYSTEM_PROMPT_VERSION,
    quota,
    generatedAt: now.toISOString(),
  };

  let raw: string;

  try {
    const result = await provider.generate({
      task,
      locale: user.language,
      systemPrompt: buildSystemPrompt(task, user.language),
      serializedContext,
      maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
      timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    });

    raw = result.raw;
  } catch (error) {
    // Le message du provider n'est jamais journalisé : il peut contenir
    // l'écho de la requête, donc du contexte utilisateur (CLAUDE.md §6).
    console.warn(
      `Appel IA en échec (tâche : ${task}, erreur : ${
        error instanceof Error ? error.name : typeof error
      }).`,
    );

    const fallback = safeFallbackResponse(user.language);

    return { ...base, ...fallback, degraded: true };
  }

  const validated = validateAiOutput(raw, resolvedFacts.allowedExpenseIds);

  if (!validated.ok) {
    logAiRejection(task, validated.reason);

    const fallback = safeFallbackResponse(user.language);

    return { ...base, ...fallback, degraded: true };
  }

  return {
    ...base,
    answer: validated.response.answer,
    uncertainty: validated.response.uncertainty,
    referencedExpenseIds: validated.response.referencedExpenseIds,
    degraded: false,
  };
}

export const aiService = {
  /**
   * Usage 1 (B.2) — met en phrase les chiffres du mois déjà calculés par le
   * moteur financier. Aucune analyse, aucun conseil.
   */
  async monthlySummary(user: AuthenticatedUser, now: Date = new Date()): Promise<AiAnswerDto> {
    return runTask(user, 'MONTHLY_SUMMARY', now);
  },

  /**
   * Usage 2 (B.2) — explique une hausse à partir des seuls faits calculés en
   * amont : totaux du mois et du mois précédent, nouvelles récurrences,
   * hausses de prix confirmées, dépenses annulées. Le backend calcule, l'IA
   * rédige.
   */
  async explainIncrease(user: AuthenticatedUser, now: Date = new Date()): Promise<AiAnswerDto> {
    return runTask(user, 'EXPLAIN_INCREASE', now);
  },

  /**
   * Usage 3 (B.2) — une recommandation, dérivée d'un chiffre déjà établi
   * (hausse détectée ou économie calculée par le comparateur). Jamais un plan
   * financier, jamais un conseil personnalisé complexe.
   */
  async recommendation(user: AuthenticatedUser, now: Date = new Date()): Promise<AiAnswerDto> {
    return runTask(user, 'RECOMMENDATION', now);
  },

  /** État du quota, sans consommer de crédit. */
  async quota(user: AuthenticatedUser, now: Date = new Date()): Promise<AiAnswerDto['quota']> {
    return readAiQuota(user.id, await planOf(user, now), now);
  },

  /**
   * Disponibilité de l'assistant et quota, sans consommer de crédit.
   *
   * Permet au mobile de ne pas proposer trois boutons voués à l'échec quand
   * l'IA est désactivée (`AI_PROVIDER=none`, valeur par défaut). Le refus reste
   * appliqué par `runTask` : cette information ne sert qu'à l'affichage.
   */
  async status(user: AuthenticatedUser, now: Date = new Date()): Promise<AiStatusDto> {
    return { enabled: isAiEnabled(), quota: await aiService.quota(user, now) };
  },
};
