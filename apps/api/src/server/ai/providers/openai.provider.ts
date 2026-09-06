import { getServerEnv } from '@/lib/env/server';

import type { AiGenerationInput, AiGenerationResult, AiProvider } from '../ai.provider';

/**
 * Provider OpenAI (`specs/comparateur-et-assistant-ia.md` B.3 et B.4).
 *
 * Contraintes tenues ici :
 *  - la clé ne vit que dans `apps/api`, lue depuis l'environnement serveur et
 *    jamais journalisée, jamais renvoyée dans une réponse, jamais exposée au
 *    bundle mobile (B.4) ;
 *  - la sortie n'est pas interprétée : elle est renvoyée brute et validée par
 *    `ai.guardrails.ts` avant tout affichage (B.7) ;
 *  - l'appel est borné dans le temps : une IA lente ne bloque jamais
 *    l'application, qui reste utilisable sans elle.
 */
export class AiProviderError extends Error {
  /** Statut HTTP du provider, jamais son corps de réponse. */
  readonly status: number;

  constructor(status: number) {
    super(`Le provider IA a répondu ${String(status)}.`);
    this.name = 'AiProviderError';
    this.status = status;
  }
}

/** Forme minimale exploitée de la réponse : rien d'autre n'est lu. */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

function extractContent(payload: unknown): string {
  const response = payload as ChatCompletionResponse;
  const content = response.choices?.[0]?.message?.content;

  return typeof content === 'string' ? content : '';
}

export function createOpenAiProvider(): AiProvider {
  return {
    name: 'openai',

    async generate(input: AiGenerationInput): Promise<AiGenerationResult> {
      const env = getServerEnv();
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, input.timeoutMs);

      try {
        const response = await fetch(`${env.AI_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            // Seul endroit du code où la clé circule.
            authorization: `Bearer ${env.AI_API_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: env.AI_MODEL,
            max_tokens: input.maxOutputTokens,
            // Sortie la plus reproductible possible : le contenu doit dépendre
            // des faits transmis, pas du hasard d'échantillonnage.
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: input.systemPrompt },
              { role: 'user', content: input.serializedContext },
            ],
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          // Le corps d'erreur n'est pas lu : il pourrait contenir l'écho de la
          // requête, donc du contexte utilisateur (CLAUDE.md §6).
          throw new AiProviderError(response.status);
        }

        return { raw: extractContent(await response.json()) };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
