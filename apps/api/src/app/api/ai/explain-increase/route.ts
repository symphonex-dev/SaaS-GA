import { enforceRateLimit, route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { aiService } from '@/server/ai/ai.service';
import { requireUser } from '@/server/auth/session';

/**
 * POST /api/ai/explain-increase — usage 2 des trois autorisés (B.2).
 *
 * Le backend a déjà calculé le total du mois, celui du mois précédent, la
 * différence, les nouvelles récurrences, les hausses confirmées et les
 * dépenses annulées. L'IA ne reçoit que ces faits et les met en phrase : elle
 * ne recalcule rien et n'ajoute aucun chiffre.
 */
export const POST = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('ai:user', user.id);

  return jsonSuccess(await aiService.explainIncrease(user));
});
