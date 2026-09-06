import { enforceRateLimit, route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { importService } from '@/server/services/import.service';

/**
 * GET /api/imports/:id — `specs/import-releves.md` §10.
 *
 * Un lot appartenant à un autre utilisateur est traité comme inexistant
 * (`NOT_FOUND`) : aucune information ne fuite sur son existence.
 */
export const GET = route<{ id: string }>(async (request, context) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const { id } = await context.params;
  const batch = await importService.getBatch(user, id);

  return jsonSuccess({ batch });
});
