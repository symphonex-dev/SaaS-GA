import { comparisonOfferVerifySchema } from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { requireAdmin } from '@/server/admin/admin-access';
import { comparisonAdminService } from '@/server/services/comparison-admin.service';

/**
 * POST /api/admin/comparison-offers/:id/verify — revérification manuelle (A.6).
 *
 * C'est le seul moyen de faire repasser une offre obsolète en « vérifiée ».
 * Sans prix fourni, seules les dates bougent : le montant reste celui déjà
 * vérifié, jamais une valeur devinée.
 */
export const POST = route<{ id: string }>(async (request, context) => {
  const actor = await requireAdmin(request);
  await enforceRateLimit('api:general', actor.userId);

  const { id } = await context.params;
  const input = await parseJsonBody(request, comparisonOfferVerifySchema);
  const offer = await comparisonAdminService.verify(actor, id, input);

  return jsonSuccess({ offer });
});
