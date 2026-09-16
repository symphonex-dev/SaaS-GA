import { enforceRateLimit, route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { aiService } from '@/server/ai/ai.service';
import { requireUser } from '@/server/auth/session';

/**
 * POST /api/ai/summary — usage 1 des trois autorisés
 * (`specs/comparateur-et-assistant-ia.md` B.2).
 *
 * Met en phrase des chiffres **déjà calculés** par le moteur financier. Aucun
 * texte libre n'est accepté : la requête n'a pas de corps, l'utilisateur ne
 * peut donc poser aucune question ouverte — le chatbot est hors périmètre V1.
 *
 * Rate limit dédié `ai:user`, plus strict que l'API générale (B.8).
 */
export const POST = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('ai:user', user.id);

  return jsonSuccess(await aiService.monthlySummary(user));
});

/**
 * GET — disponibilité de l'assistant (`enabled`) et quota mensuel, sans
 * consommer de crédit.
 */
export const GET = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  return jsonSuccess(await aiService.status(user));
});
