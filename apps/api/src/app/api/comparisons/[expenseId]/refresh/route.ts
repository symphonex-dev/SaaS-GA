import { enforceRateLimit, route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { comparisonService } from '@/server/services/comparison.service';

/**
 * POST /api/comparisons/:expenseId/refresh — rejoue le rapprochement (A.7).
 *
 * Aucune collecte de prix n'a lieu : la base d'offres est alimentée à la main
 * (A.1). « Rafraîchir » relance le matching déterministe sur l'état courant de
 * cette base — une offre périmée entre-temps disparaît, une offre revérifiée
 * par un administrateur réapparaît.
 */
export const POST = route<{ expenseId: string }>(async (request, context) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const { expenseId } = await context.params;

  return jsonSuccess(await comparisonService.refresh(user, expenseId));
});
