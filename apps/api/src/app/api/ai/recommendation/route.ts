import { enforceRateLimit, route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { aiService } from '@/server/ai/ai.service';
import { requireUser } from '@/server/auth/session';

/**
 * POST /api/ai/recommendation — usage 3 des trois autorisés (B.2).
 *
 * Une recommandation, dérivée strictement d'un chiffre déjà établi : une
 * hausse détectée par le moteur déterministe ou une économie calculée par le
 * comparateur. Jamais un plan financier, jamais un conseil d'investissement ou
 * de crédit, jamais une incitation à résilier — les garde-fous de sortie
 * rejettent ces cas avant tout affichage (B.7).
 */
export const POST = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('ai:user', user.id);

  return jsonSuccess(await aiService.recommendation(user));
});
