import { createSavingsGoalSchema } from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { savingsService } from '@/server/services/savings.service';

/**
 * GET /api/savings — objectifs d'épargne de l'utilisateur.
 *
 * Les montants d'économies potentielles et confirmées sont portés par
 * `GET /api/dashboard` (`specs/calculs-financiers.md` §8) : cette route ne
 * renvoie que les objectifs, jamais un calcul refait côté mobile.
 */
export const GET = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  return jsonSuccess({ goals: await savingsService.list(user) });
});

/**
 * POST — crée un objectif d'épargne.
 *
 * Le nombre d'objectifs est plafonné par l'offre (`savingsGoalsLimit`,
 * `specs/paiement-in-app.md` §2), contrôle exclusivement serveur.
 */
export const POST = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const input = await parseJsonBody(request, createSavingsGoalSchema);

  return jsonSuccess({ goal: await savingsService.create(user, input) }, { status: 201 });
});
