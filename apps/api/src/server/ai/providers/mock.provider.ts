import type { AiGenerationInput, AiGenerationResult, AiProvider } from '../ai.provider';

/**
 * Provider de test (`specs/comparateur-et-assistant-ia.md` B.3).
 *
 * Déterministe et hors ligne : il ne fait aucun appel réseau et produit
 * toujours la même sortie pour la même entrée. Sa seule raison d'être est de
 * prouver que le provider est interchangeable et que les garde-fous, les
 * quotas et les routes fonctionnent sans dépendre d'un service externe.
 *
 * Il ne « comprend » rien : il recopie une phrase construite à partir des
 * faits déjà présents dans le contexte, sans jamais en inventer.
 */
interface MockContextShape {
  month?: unknown;
  currency?: unknown;
  monthlyTotal?: unknown;
}

function readContext(serialized: string): MockContextShape {
  try {
    return JSON.parse(serialized) as MockContextShape;
  } catch {
    return {};
  }
}

function answerFor(input: AiGenerationInput): string {
  const context = readContext(input.serializedContext);
  const month = typeof context.month === 'string' ? context.month : 'unknown period';
  const total = typeof context.monthlyTotal === 'string' ? context.monthlyTotal : '0';
  const currency = typeof context.currency === 'string' ? context.currency : '';

  switch (input.task) {
    case 'MONTHLY_SUMMARY':
      return `Summary for ${month}: total ${total} ${currency}.`;
    case 'EXPLAIN_INCREASE':
      return `Change for ${month} explained from the supplied totals (${total} ${currency}).`;
    default:
      return `One recommendation based on the supplied figures for ${month}.`;
  }
}

/**
 * Provider par défaut des tests : sortie toujours conforme au schéma B.7.
 *
 * Les scénarios de rejet (sortie hors schéma, référence fabriquée, contenu hors
 * périmètre) utilisent `createScriptedProvider`, qui renvoie une chaîne brute
 * choisie par le test.
 */
export function createMockProvider(): AiProvider {
  return {
    name: 'mock',
    generate(input: AiGenerationInput): Promise<AiGenerationResult> {
      return Promise.resolve({
        raw: JSON.stringify({
          answer: answerFor(input),
          uncertainty: 'LOW',
          referencedExpenseIds: [],
        }),
      });
    },
  };
}

/** Provider renvoyant une sortie brute imposée — pour tester les garde-fous. */
export function createScriptedProvider(raw: string | (() => Promise<never>)): AiProvider {
  return {
    name: 'scripted',
    generate(): Promise<AiGenerationResult> {
      return typeof raw === 'string' ? Promise.resolve({ raw }) : raw();
    },
  };
}
