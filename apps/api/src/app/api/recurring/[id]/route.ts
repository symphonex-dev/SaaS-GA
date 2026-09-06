import { modifyRecurringDetectionSchema } from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { recurringDetectionService } from '@/server/services/recurring-detection.service';

/**
 * PATCH /api/recurring/:id — `specs/moteur-recurrence.md` §8.
 *
 * L'utilisateur corrige la fréquence proposée : `status = MODIFIED`. La
 * fréquence choisie fait ensuite autorité sur le moteur, qui ne la réécrit plus
 * lors des exécutions suivantes.
 */
export const PATCH = route<{ id: string }>(async (request, context) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const { id } = await context.params;
  const input = await parseJsonBody(request, modifyRecurringDetectionSchema);
  const detection = await recurringDetectionService.modify(user, id, input);

  return jsonSuccess({ detection });
});
