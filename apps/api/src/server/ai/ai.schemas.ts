import { aiResponseSchema, type AiResponse } from '@subscription-manager/shared';

/**
 * Schéma de sortie de l'IA (`specs/comparateur-et-assistant-ia.md` B.7).
 *
 * Le schéma lui-même vit dans `packages/shared/validation/ai.ts` : la même
 * définition sert à valider côté serveur et à typer le DTO côté mobile. Ce
 * module n'ajoute que la lecture défensive du texte brut renvoyé par un
 * provider, qui n'est **jamais** du JSON garanti.
 */
export { aiResponseSchema };
export type { AiResponse };

export type AiParseFailure = 'NOT_JSON' | 'SCHEMA';

export type AiParseResult =
  { ok: true; response: AiResponse } | { ok: false; failure: AiParseFailure };

/**
 * Extrait l'objet JSON d'une sortie de modèle.
 *
 * Les modèles encadrent régulièrement leur JSON de texte ou de balises de code.
 * On accepte donc un objet unique délimité par la première `{` et la dernière
 * `}` — mais rien de plus permissif : aucune réparation, aucune tolérance sur
 * le contenu, aucune valeur par défaut inventée.
 */
export function extractJsonObject(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    return undefined;
  }

  try {
    return JSON.parse(raw.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Analyse et valide une sortie brute.
 *
 * Aucun texte non conforme n'est « rattrapé » : l'appelant remplace une sortie
 * invalide par la réponse générique sûre (B.7).
 */
export function parseAiResponse(raw: string): AiParseResult {
  const candidate = extractJsonObject(raw);

  if (candidate === undefined) {
    return { ok: false, failure: 'NOT_JSON' };
  }

  const parsed = aiResponseSchema.safeParse(candidate);

  return parsed.success ? { ok: true, response: parsed.data } : { ok: false, failure: 'SCHEMA' };
}
