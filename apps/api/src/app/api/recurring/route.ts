import { enforceRateLimit, route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { dashboardService } from '@/server/services/dashboard.service';

/**
 * GET /api/recurring — liste des récurrences de l'utilisateur.
 *
 * Ajout par rapport aux routes de `specs/moteur-recurrence.md` §8, qui ne
 * décrit que les trois actions d'arbitrage : sans cette lecture, la page
 * « Abonnements » de `specs/ui-composants-mobile.md` §6 n'aurait aucune source
 * de données. Tout est calculé côté serveur (coût annuel, prochaine échéance,
 * variation de prix) — le mobile affiche (CLAUDE.md §5.1).
 */
export const GET = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const subscriptions = await dashboardService.listSubscriptions(user);

  return jsonSuccess({ subscriptions });
});
