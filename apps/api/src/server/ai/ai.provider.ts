import type { AiTask, Locale } from '@subscription-manager/shared';

import { getServerEnv } from '@/lib/env/server';

import { createMockProvider } from './providers/mock.provider';
import { createOpenAiProvider } from './providers/openai.provider';

/**
 * Injection du provider IA (`specs/comparateur-et-assistant-ia.md` B.3).
 *
 * Le provider est choisi **par configuration serveur** (`AI_PROVIDER`), jamais
 * codé en dur dans un service. Aucun provider configuré signifie simplement
 * « pas d'IA » : les trois usages sont un enrichissement, jamais un prérequis
 * fonctionnel — tableau de bord, comparateur, import et récurrences
 * fonctionnent à l'identique sans eux.
 */
export interface AiGenerationInput {
  task: AiTask;
  locale: Locale;
  /** Message système versionné (B.6) — produit par `ai.prompt.ts`. */
  systemPrompt: string;
  /** Contexte déjà rédigé, vérifié et sérialisé par `ai.redaction.ts`. */
  serializedContext: string;
  maxOutputTokens: number;
  /** Délai au-delà duquel l'appel est abandonné. */
  timeoutMs: number;
}

export interface AiGenerationResult {
  /** Texte brut du modèle : jamais affiché, toujours validé d'abord (B.7). */
  raw: string;
}

export interface AiProvider {
  readonly name: string;
  generate(input: AiGenerationInput): Promise<AiGenerationResult>;
}

/**
 * Provider forcé, réservé aux tests.
 *
 * Il n'existe aucun moyen de le définir depuis une requête HTTP : seule une
 * importation directe du module le permet.
 */
let override: AiProvider | null = null;

export function setAiProviderForTesting(provider: AiProvider | null): void {
  override = provider;
}

/**
 * Provider courant, ou `null` si l'IA est désactivée.
 *
 * `openai` sans clé configurée renvoie `null` : mieux vaut une fonctionnalité
 * explicitement absente qu'un appel voué à échouer à chaque requête.
 *
 * `mock` est ignoré en production : c'est un double de test, dont les phrases
 * fabriquées ne doivent jamais être présentées à un utilisateur réel comme une
 * réponse de l'assistant. L'IA y est alors simplement désactivée, sans bloquer
 * le démarrage — elle n'est jamais un prérequis (B.3).
 */
export function resolveAiProvider(): AiProvider | null {
  if (override !== null) {
    return override;
  }

  const env = getServerEnv();

  switch (env.AI_PROVIDER) {
    case 'mock':
      return env.NODE_ENV === 'production' ? null : createMockProvider();
    case 'openai':
      return env.AI_API_KEY.length === 0 ? null : createOpenAiProvider();
    default:
      return null;
  }
}

export function isAiEnabled(): boolean {
  return resolveAiProvider() !== null;
}
