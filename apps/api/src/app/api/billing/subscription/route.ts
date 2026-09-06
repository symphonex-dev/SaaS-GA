import { enforceRateLimit, route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { getEntitlements } from '@/server/entitlements/entitlements';
import { billingService } from '@/server/services/billing.service';

/**
 * GET /api/billing/subscription — état d'abonnement et droits en vigueur.
 *
 * Route de lecture ajoutée pour que l'écran de facturation du mobile puisse
 * afficher l'offre courante sans rien déduire lui-même : le plan **réellement
 * en vigueur** et les entitlements sont résolus côté serveur
 * (`specs/paiement-in-app.md` §7). Le mobile ne lit jamais `currentPeriodEnd`
 * pour décider d'un droit.
 *
 * Aucun identifiant de transaction de store n'est exposé.
 */
export const GET = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const { subscription, plan } = await billingService.getSubscription(user);

  return jsonSuccess({ subscription, plan, entitlements: getEntitlements(plan) });
});
