import { enforceRateLimit, route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { comparisonService } from '@/server/services/comparison.service';

/**
 * GET /api/comparisons/:expenseId — comparaison d'un abonnement précis (A.7).
 *
 * Une dépense appartenant à un autre utilisateur est traitée comme
 * inexistante (`NOT_FOUND`) : l'isolation ne révèle jamais l'existence d'une
 * ressource voisine (CLAUDE.md §5.3).
 */
export const GET = route<{ expenseId: string }>(async (request, context) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const { expenseId } = await context.params;

  return jsonSuccess(await comparisonService.detail(user, expenseId));
});
