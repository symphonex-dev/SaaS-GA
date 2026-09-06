import { enforceRateLimit, route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { comparisonService } from '@/server/services/comparison.service';

/**
 * GET /api/comparisons — `specs/comparateur-et-assistant-ia.md` A.7.
 *
 * Liste les abonnements actifs de l'utilisateur et leurs alternatives
 * vérifiées. Le `userId` provient exclusivement de la session, jamais du
 * client. Un abonnement sans alternative fiable est renvoyé avec une liste
 * d'offres vide : le mobile affiche alors « aucune alternative vérifiée
 * disponible », jamais un résultat forcé (A.2).
 */
export const GET = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  return jsonSuccess(await comparisonService.list(user));
});
