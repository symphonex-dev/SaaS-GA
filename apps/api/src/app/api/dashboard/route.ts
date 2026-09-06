import { enforceRateLimit, route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { dashboardService } from '@/server/services/dashboard.service';

/**
 * GET /api/dashboard — `specs/calculs-financiers.md` §8.
 *
 * Renvoie `DashboardData` entièrement calculé côté serveur : le mobile ne
 * recalcule aucun KPI (CLAUDE.md §5.1). Les montants sont exprimés dans la
 * devise de l'utilisateur ; les dépenses libellées dans une autre devise sont
 * signalées séparément, jamais converties en silence (§7).
 */
export const GET = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const dashboard = await dashboardService.build(user);

  return jsonSuccess(dashboard);
});
