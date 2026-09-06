import { createExpenseSchema, type ExpenseDto } from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { dashboardRepository } from '@/server/repositories/dashboard.repository';
import { expenseService, toExpenseDto } from '@/server/services/expense.service';

/**
 * GET /api/expenses — transactions de l'utilisateur, les plus récentes d'abord.
 *
 * Lecture seule : la création et la correction manuelles (`source = MANUAL`)
 * restent une action secondaire, traitée avec le reste du CRUD des dépenses.
 * `merchantDisplay` est résolu côté serveur — la correction manuelle prime sur
 * la normalisation (`specs/import-releves.md` §9).
 */
const MAX_EXPENSES = 200;

export const GET = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const rows = await dashboardRepository.listExpenses(user.id);

  const expenses: ExpenseDto[] = rows
    .slice()
    .sort((left, right) => right.date.getTime() - left.date.getTime())
    .slice(0, MAX_EXPENSES)
    .flatMap((expense) => {
      const dto = toExpenseDto(expense);

      return dto === null ? [] : [dto];
    });

  return jsonSuccess({ expenses });
});

/**
 * POST — ajoute une transaction absente du relevé (espèces, oubli bancaire).
 *
 * Action **secondaire** (CLAUDE.md §5.4) : elle n'est jamais mise en avant, et
 * la ligne créée est marquée `MANUAL` par le serveur — un client ne peut pas la
 * faire passer pour une ligne importée.
 */
export const POST = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const input = await parseJsonBody(request, createExpenseSchema);

  return jsonSuccess({ expense: await expenseService.create(user, input) }, { status: 201 });
});
