import { enforceRateLimit, route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { comparisonService } from '@/server/services/comparison.service';

/**
 * GET /api/comparisons/:expenseId/offers — alternatives seules (A.7).
 *
 * Chaque offre porte sa fraîcheur, sa date de dernière vérification et sa date
 * de prochaine vérification (A.5). Le classement est le prix croissant : il ne
 * dépend jamais de l'existence d'une commission (A.2).
 */
export const GET = route<{ expenseId: string }>(async (request, context) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const { expenseId } = await context.params;

  return jsonSuccess(await comparisonService.offers(user, expenseId));
});
