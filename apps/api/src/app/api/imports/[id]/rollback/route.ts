import { enforceRateLimit, route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { importService } from '@/server/services/import.service';

/**
 * POST /api/imports/:id/rollback — `specs/import-releves.md` §10.
 *
 * Supprime uniquement les dépenses créées par ce lot — jamais les transactions
 * préexistantes ayant servi à la détection de doublons — et marque le lot
 * comme annulé. Un lot déjà annulé ne peut pas l'être une seconde fois.
 */
export const POST = route<{ id: string }>(async (request, context) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const { id } = await context.params;
  const result = await importService.rollback(user, id);

  return jsonSuccess(result);
});
