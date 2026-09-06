import { verifyPurchaseSchema } from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { billingService } from '@/server/services/billing.service';

/**
 * POST /api/billing/purchase/verify — `specs/paiement-in-app.md` §4.
 *
 * Le corps ne contient qu'une preuve d'achat : ni plan, ni statut, ni date de
 * fin de période. Le serveur revérifie le jeton auprès de l'API du store et
 * n'écrit qu'en cas de succès (§1) — un client ne peut donc pas s'accorder
 * l'offre Plus par une requête arbitraire.
 *
 * Aucune donnée de carte bancaire ne transite ici : le paiement a déjà eu lieu
 * dans le compte Google Play / Apple de l'utilisateur.
 */
export const POST = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const input = await parseJsonBody(request, verifyPurchaseSchema);
  const subscription = await billingService.verifyPurchase(user, input);

  return jsonSuccess({ subscription });
});
