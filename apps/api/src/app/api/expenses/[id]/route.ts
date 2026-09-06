import { updateExpenseSchema } from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { expenseService } from '@/server/services/expense.service';

/**
 * Transaction unitaire (`specs/ui-composants-mobile.md` §10).
 *
 * Fonction **secondaire** : corriger une ligne importée, ou supprimer une
 * transaction saisie par erreur. Le parcours principal reste l'import de
 * relevé (CLAUDE.md §5.4).
 *
 * Isolation : le `userId` vient exclusivement de la session, et la transaction
 * d'un autre utilisateur est traitée comme inexistante (`NOT_FOUND`).
 */
export const GET = route<{ id: string }>(async (request, context) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const { id } = await context.params;

  return jsonSuccess({ expense: await expenseService.get(user, id) });
});

/** PATCH — correction manuelle (montant, date, catégorie, libellé, statut). */
export const PATCH = route<{ id: string }>(async (request, context) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const { id } = await context.params;
  const input = await parseJsonBody(request, updateExpenseSchema);

  return jsonSuccess({ expense: await expenseService.update(user, id, input) });
});

/** DELETE — supprime la transaction et les détections qui s'y rattachaient. */
export const DELETE = route<{ id: string }>(async (request, context) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const { id } = await context.params;

  return jsonSuccess(await expenseService.remove(user, id));
});
