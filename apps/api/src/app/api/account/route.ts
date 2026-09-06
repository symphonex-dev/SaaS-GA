import { deleteAccountSchema } from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { userService } from '@/server/services/user.service';

/**
 * DELETE /api/account — `specs/auth-comptes-rgpd.md` §9.
 *
 * Suppression irréversible, conditionnée à :
 *  1. une session valide ;
 *  2. la confirmation explicite `DELETE_MY_ACCOUNT` ;
 *  3. l'absence d'abonnement payant actif non résilié
 *     (`ACCOUNT_DELETION_BLOCKED_ACTIVE_SUBSCRIPTION`).
 *
 * Une résiliation débloque la suppression immédiatement, sans attendre la fin
 * de la période déjà payée (CLAUDE.md §5.9).
 */
export const DELETE = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  await parseJsonBody(request, deleteAccountSchema);
  await userService.deleteAccount(user.id);

  return jsonSuccess({ deleted: true });
});
