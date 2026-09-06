import { updateSavingsGoalSchema } from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { savingsService } from '@/server/services/savings.service';

/**
 * Objectif d'épargne unitaire (`specs/ui-composants-mobile.md` §8).
 *
 * C'est par ici que passe la **confirmation** d'une économie : l'utilisateur
 * déclare avoir réalisé le montant. Rien n'est jamais confirmé automatiquement
 * par le moteur, et le potentiel reste distinct du confirmé
 * (`specs/calculs-financiers.md` §6).
 */
export const PATCH = route<{ id: string }>(async (request, context) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const { id } = await context.params;
  const input = await parseJsonBody(request, updateSavingsGoalSchema);

  return jsonSuccess({ goal: await savingsService.update(user, id, input) });
});

/** DELETE — abandonne définitivement un objectif. */
export const DELETE = route<{ id: string }>(async (request, context) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const { id } = await context.params;

  return jsonSuccess(await savingsService.remove(user, id));
});
