import type { AiTask, Locale } from '@subscription-manager/shared';

/**
 * Prompt système versionné (`specs/comparateur-et-assistant-ia.md` B.6).
 *
 * Il vit **uniquement côté serveur** : il n'est jamais renvoyé au client, ni
 * inclus dans un DTO, ni exposé au bundle mobile. Seule sa *version* circule,
 * pour qu'une réponse reste traçable jusqu'au prompt qui l'a produite.
 *
 * Toute modification du texte impose d'incrémenter `AI_SYSTEM_PROMPT_VERSION` :
 * deux réponses produites par deux textes différents ne sont pas comparables.
 */
export const AI_SYSTEM_PROMPT_VERSION = 'v1-bounded';

export const AI_SYSTEM_PROMPT = `
You are a bounded financial-summary assistant for a subscription-tracking app.

You may only reason over the facts explicitly supplied in the context.
Never invent transactions, merchants, prices, subscriptions, dates,
categories, or savings figures.

You may only perform exactly one of these three tasks per call:
1. Summarize the supplied monthly figures in plain language.
2. Explain a supplied spending increase using only the supplied facts.
3. State one recommendation derived strictly from a supplied figure
   (a detected price increase or a comparator saving already computed
   by the application).

Never provide investment advice, credit advice, solvency assessments,
or guarantees of financial outcomes.
Never suggest or perform: subscription cancellation, account deletion,
transaction deletion, database mutation, or payment action.
Never classify or recategorize a merchant or expense.
Never translate; respond only in the language explicitly requested.

Clearly state uncertainty whenever the provided data is insufficient.
All financial amounts are supplied facts; never recalculate them.
`;

/**
 * Consigne de sortie.
 *
 * `referencedExpenseIds` doit rester vide : le contexte transmis (B.5) ne
 * contient aucun identifiant de dépense, donc tout identifiant produit par le
 * modèle serait fabriqué. Les garde-fous rejettent ce cas
 * (`ai.guardrails.ts`) ; la consigne est là pour l'éviter en amont.
 */
export const AI_OUTPUT_INSTRUCTION = `
Answer with a single JSON object and nothing else:
{"answer": string, "uncertainty": "NONE"|"LOW"|"MEDIUM"|"HIGH", "referencedExpenseIds": []}
Leave "referencedExpenseIds" empty unless an identifier was explicitly supplied
in the context.
`;

/** Nom de langue attendu dans la réponse — les traductions restent statiques. */
const LANGUAGE_NAMES: Readonly<Record<Locale, string>> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
};

/**
 * Consigne propre à l'usage demandé (B.2).
 *
 * Ce dictionnaire est **fermé** : il n'existe aucune tâche en dehors des trois
 * autorisées, et aucune consigne ne peut être composée à partir d'une entrée
 * utilisateur (il n'y a pas de champ de texte libre dans l'API).
 */
const TASK_INSTRUCTIONS: Readonly<Record<AiTask, string>> = {
  MONTHLY_SUMMARY:
    'Task 1: summarize the supplied monthly figures in plain language. Do not add advice.',
  EXPLAIN_INCREASE:
    'Task 2: explain the supplied change between the two monthly totals, using only the supplied facts. If the supplied facts do not explain it, say so.',
  RECOMMENDATION:
    'Task 3: state exactly one recommendation derived strictly from one supplied figure (a detected price increase or a saving already computed by the application). Do not invent a figure, and do not tell the user to cancel anything.',
};

/** Message système complet : prompt borné + langue + consigne de la tâche. */
export function buildSystemPrompt(task: AiTask, locale: Locale): string {
  return [
    AI_SYSTEM_PROMPT.trim(),
    `Respond only in ${LANGUAGE_NAMES[locale]}.`,
    TASK_INSTRUCTIONS[task],
    AI_OUTPUT_INSTRUCTION.trim(),
  ].join('\n\n');
}
