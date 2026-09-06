import { enforceRateLimit, route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { recurringDetectionService } from '@/server/services/recurring-detection.service';

/**
 * POST /api/recurring/:id/reject — `specs/moteur-recurrence.md` §8.
 *
 * L'utilisateur peut toujours rejeter une proposition : `status = REJECTED`.
 * Une détection rejetée n'est jamais recréée par une exécution ultérieure du
 * moteur.
 */
export const POST = route<{ id: string }>(async (request, context) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const { id } = await context.params;
  const detection = await recurringDetectionService.reject(user, id);

  return jsonSuccess({ detection });
});
