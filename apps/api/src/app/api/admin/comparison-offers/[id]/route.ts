import { comparisonOfferPatchSchema } from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { requireAdmin } from '@/server/admin/admin-access';
import { comparisonAdminService } from '@/server/services/comparison-admin.service';

/**
 * PATCH /api/admin/comparison-offers/:id — modification auditée (A.8).
 *
 * Le patch est fusionné puis **revalidé en entier** : les invariants d'une
 * offre portent sur des couples de champs et ne peuvent pas être vérifiés
 * champ par champ.
 */
export const PATCH = route<{ id: string }>(async (request, context) => {
  const actor = await requireAdmin(request);
  await enforceRateLimit('api:general', actor.userId);

  const { id } = await context.params;
  const patch = await parseJsonBody(request, comparisonOfferPatchSchema);
  const offer = await comparisonAdminService.update(actor, id, patch);

  return jsonSuccess({ offer });
});

/** DELETE — suppression auditée : la trace conserve l'état « avant » complet. */
export const DELETE = route<{ id: string }>(async (request, context) => {
  const actor = await requireAdmin(request);
  await enforceRateLimit('api:general', actor.userId);

  const { id } = await context.params;

  return jsonSuccess(await comparisonAdminService.remove(actor, id));
});

/** GET — journal d'audit de l'offre (qui, quand, avant/après). */
export const GET = route<{ id: string }>(async (request, context) => {
  const actor = await requireAdmin(request);
  await enforceRateLimit('api:general', actor.userId);

  const { id } = await context.params;

  return jsonSuccess(await comparisonAdminService.audits(id));
});
