import { enforceRateLimit, route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { recurringDetectionService } from '@/server/services/recurring-detection.service';

/**
 * POST /api/recurring/:id/confirm — `specs/moteur-recurrence.md` §8.
 *
 * L'utilisateur valide la récurrence proposée : `status = CONFIRMED`.
 * Une détection appartenant à un autre utilisateur est traitée comme
 * inexistante (§9).
 */
export const POST = route<{ id: string }>(async (request, context) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const { id } = await context.params;
  const detection = await recurringDetectionService.confirm(user, id);

  return jsonSuccess({ detection });
});
