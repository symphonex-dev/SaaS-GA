import type { AiResponse, AiTask, Locale } from '@subscription-manager/shared';

import { parseAiResponse } from './ai.schemas';

/**
 * Garde-fous de sortie (`specs/comparateur-et-assistant-ia.md` B.7 et B.10).
 *
 * Aucune sortie de modèle n'atteint l'utilisateur sans avoir traversé ce
 * module. Une sortie rejetée est journalisée — **sans son contenu** — et
 * remplacée par une réponse générique sûre, jamais affichée telle quelle.
 */

export type AiRejectionReason =
  /** Sortie non JSON, ou hors du schéma `aiResponseSchema`. */
  | 'SCHEMA'
  /** Référence à une dépense que le serveur n'a pas fournie : contenu fabriqué. */
  | 'UNKNOWN_EXPENSE_REFERENCE'
  /** Contenu relevant d'un usage explicitement hors périmètre V1 (B.2). */
  | 'OUT_OF_SCOPE_CONTENT';

export type AiValidationResult =
  { ok: true; response: AiResponse } | { ok: false; reason: AiRejectionReason };

/**
 * Formulations relevant des usages interdits (B.2) : conseil d'investissement
 * ou de crédit, évaluation de solvabilité, garantie de résultat, incitation à
 * une action destructive (résiliation, suppression, paiement).
 *
 * Filtre volontairement **étroit** : il vise des tournures explicites, pas le
 * vocabulaire financier ordinaire, pour ne pas rejeter un résumé légitime.
 * C'est une seconde barrière — la première est le prompt borné (B.6).
 */
const OUT_OF_SCOPE_PATTERNS: readonly RegExp[] = [
  // Conseil d'investissement / crédit / solvabilité.
  /\b(?:invest(?:ing|ment)?s?\s+(?:advice|in)|you\s+should\s+invest)\b/i,
  /\b(?:credit\s+score|creditworthiness|solvency)\b/i,
  /\bconseil(?:s)?\s+(?:en\s+)?(?:investissement|placement|cr[ée]dit)\b/i,
  /\b(?:solvabilit[ée]|score\s+de\s+cr[ée]dit)\b/i,
  /\b(?:asesoramiento|consejo)\s+de\s+inversi[óo]n\b/i,
  /\b(?:solvencia|puntaje\s+crediticio)\b/i,

  // Garantie de résultat financier.
  /\b(?:guarantee[sd]?|guaranteed)\s+(?:returns?|savings?|profit)/i,
  /\b(?:je\s+)?(?:vous\s+)?garantis?\b/i,
  /\b(?:garantizo|garantizamos)\b/i,

  // Incitation à une action destructive ou de paiement.
  /\b(?:cancel|delete)\s+(?:your\s+)?(?:subscription|account|transaction)\b/i,
  /\b(?:r[ée]siliez|supprimez)\s+(?:votre|vos|cet|cette)\b/i,
  /\b(?:cancela|elimina)\s+(?:tu|su)\s+(?:suscripci[óo]n|cuenta)\b/i,
];

/**
 * Réponse générique sûre (B.7).
 *
 * Texte **statique**, versionné avec le code, dans les trois langues de l'app :
 * il n'est jamais produit par une IA et jamais traduit à la volée
 * (CLAUDE.md §5.6). Il n'affirme aucun chiffre.
 */
const SAFE_FALLBACK: Readonly<Record<Locale, string>> = {
  en: 'The assistant could not produce a reliable summary this time. Your figures are unaffected: they remain available on the dashboard.',
  fr: "L'assistant n'a pas pu produire de résumé fiable cette fois-ci. Vos chiffres ne sont pas affectés : ils restent disponibles sur le tableau de bord.",
  es: 'El asistente no ha podido generar un resumen fiable esta vez. Tus cifras no se ven afectadas: siguen disponibles en el panel.',
};

export function safeFallbackResponse(locale: Locale): AiResponse {
  return {
    answer: SAFE_FALLBACK[locale],
    // Le repli ne prétend rien : l'incertitude est maximale par construction.
    uncertainty: 'HIGH',
    referencedExpenseIds: [],
  };
}

/**
 * Journalisation d'un rejet.
 *
 * Ni le contenu de la réponse, ni le contexte, ni aucune donnée utilisateur :
 * uniquement la tâche et le motif (CLAUDE.md §6 — aucune donnée sensible dans
 * les logs).
 */
export function logAiRejection(task: AiTask, reason: AiRejectionReason): void {
  console.warn(`Sortie IA rejetée (tâche : ${task}, motif : ${reason}).`);
}

/**
 * Valide une sortie brute de provider.
 *
 * `allowedExpenseIds` est l'ensemble des dépenses ayant servi à construire les
 * faits. Le contexte transmis n'en contient aucun identifiant (B.5) : une
 * référence hors de cet ensemble est donc nécessairement fabriquée, et la
 * réponse entière est rejetée plutôt que nettoyée en silence.
 */
export function validateAiOutput(
  raw: string,
  allowedExpenseIds: readonly string[],
): AiValidationResult {
  const parsed = parseAiResponse(raw);

  if (!parsed.ok) {
    return { ok: false, reason: 'SCHEMA' };
  }

  const allowed = new Set(allowedExpenseIds);

  if (parsed.response.referencedExpenseIds.some((id) => !allowed.has(id))) {
    return { ok: false, reason: 'UNKNOWN_EXPENSE_REFERENCE' };
  }

  if (OUT_OF_SCOPE_PATTERNS.some((pattern) => pattern.test(parsed.response.answer))) {
    return { ok: false, reason: 'OUT_OF_SCOPE_CONTENT' };
  }

  return { ok: true, response: parsed.response };
}
