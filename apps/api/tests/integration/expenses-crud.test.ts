import type { AuthenticatedSessionDto, ExpenseDto } from '@subscription-manager/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  DELETE as deleteExpenseRoute,
  GET as getExpenseRoute,
  PATCH as patchExpenseRoute,
} from '@/app/api/expenses/[id]/route';
import { GET as listExpensesRoute, POST as createExpenseRoute } from '@/app/api/expenses/route';
import { resetRateLimits } from '@/lib/security/rate-limit';

import { createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/**
 * Saisie manuelle et correction de transactions
 * (`specs/ui-composants-mobile.md` §10, CLAUDE.md §5.4).
 *
 * Fonction secondaire, mais soumise aux mêmes règles que le reste : Zod,
 * `requireUser()`, et isolation stricte par `userId`.
 */
const VALID_EXPENSE = {
  merchantRaw: 'CARTE 12/03 NETFLIX.COM',
  merchantNormalized: 'Netflix',
  amount: { minorUnits: '1599', currency: 'EUR' },
  date: '2026-08-05T00:00:00.000Z',
  frequency: 'MONTHLY',
  category: 'STREAMING',
  paymentMethod: 'CARD',
  notes: null,
  status: 'ACTIVE',
  source: 'IMPORT',
};

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('transactions saisies manuellement', () => {
  let session: AuthenticatedSessionDto;
  let other: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();

    session = await createUserWithSession({ email: 'saisie@example.com' });
    other = await createUserWithSession({ email: 'voisin@example.com' });
  });

  async function createExpense(token: string): Promise<ExpenseDto> {
    const { expense } = await expectSuccess<{ expense: ExpenseDto }>(
      await createExpenseRoute(
        apiRequest('/api/expenses', { method: 'POST', token, body: VALID_EXPENSE }),
      ),
    );

    return expense;
  }

  it('exige une session valide sur toutes les opérations', async () => {
    const responses = await Promise.all([
      createExpenseRoute(apiRequest('/api/expenses', { method: 'POST', body: VALID_EXPENSE })),
      getExpenseRoute(apiRequest('/api/expenses/exp_1'), context('exp_1')),
      patchExpenseRoute(
        apiRequest('/api/expenses/exp_1', { method: 'PATCH', body: { notes: 'x' } }),
        context('exp_1'),
      ),
      deleteExpenseRoute(apiRequest('/api/expenses/exp_1', { method: 'DELETE' }), context('exp_1')),
    ]);

    for (const response of responses) {
      expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
    }
  });

  it('crée une transaction et la marque MANUAL, quoi que dise le client', async () => {
    const expense = await createExpense(session.token);

    // Le client a envoyé `source: 'IMPORT'` : le serveur impose `MANUAL`.
    expect(expense.source).toBe('MANUAL');
    expect(expense.amount).toEqual({ minorUnits: '1599', currency: 'EUR' });
    expect(expense.importBatchId).toBeNull();
  });

  it('normalise le libellé du commerçant comme le pipeline d’import', async () => {
    const expense = await createExpense(session.token);

    // Même normalisation que pour une ligne importée : les deux doivent se
    // regrouper dans le moteur de récurrence.
    expect(expense.merchantNormalized).toBe('Netflix');
    expect(expense.merchantRaw).toBe(VALID_EXPENSE.merchantRaw);
    expect(expense.merchantDisplay).toBe('Netflix');
  });

  it('refuse un montant négatif ou nul', async () => {
    for (const minorUnits of ['-1599', '0']) {
      const response = await createExpenseRoute(
        apiRequest('/api/expenses', {
          method: 'POST',
          token: session.token,
          body: { ...VALID_EXPENSE, amount: { minorUnits, currency: 'EUR' } },
        }),
      );

      expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
    }
  });

  it('corrige une transaction sans écraser le libellé d’origine', async () => {
    const created = await createExpense(session.token);

    const { expense } = await expectSuccess<{ expense: ExpenseDto }>(
      await patchExpenseRoute(
        apiRequest(`/api/expenses/${created.id}`, {
          method: 'PATCH',
          token: session.token,
          body: {
            merchantOverride: 'Netflix Standard',
            amount: { minorUnits: '1799', currency: 'EUR' },
            category: 'ENTERTAINMENT',
          },
        }),
        context(created.id),
      ),
    );

    expect(expense.merchantOverride).toBe('Netflix Standard');
    // La correction prime à l'affichage, l'original reste intact (§9 import).
    expect(expense.merchantDisplay).toBe('Netflix Standard');
    expect(expense.merchantRaw).toBe(VALID_EXPENSE.merchantRaw);
    expect(expense.amount.minorUnits).toBe('1799');
    expect(expense.category).toBe('ENTERTAINMENT');
  });

  it('refuse un patch vide', async () => {
    const created = await createExpense(session.token);

    const response = await patchExpenseRoute(
      apiRequest(`/api/expenses/${created.id}`, {
        method: 'PATCH',
        token: session.token,
        body: {},
      }),
      context(created.id),
    );

    expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
  });

  it('supprime une transaction et les détections qui s’y rattachaient', async () => {
    const created = await createExpense(session.token);

    await tables.recurringDetection.create({
      data: {
        userId: session.user.id,
        expenseId: created.id,
        frequency: 'MONTHLY',
        confidenceScore: 'HIGH',
        status: 'CONFIRMED',
        intervalDays: 30,
        amountVariance: '0.0000',
      },
    });

    await expectSuccess<{ deleted: true }>(
      await deleteExpenseRoute(
        apiRequest(`/api/expenses/${created.id}`, { method: 'DELETE', token: session.token }),
        context(created.id),
      ),
    );

    expect(tables.expense.rows).toHaveLength(0);
    // Une détection orpheline afficherait un abonnement sans dépense.
    expect(tables.recurringDetection.rows).toHaveLength(0);
  });

  it('traite comme inexistante la transaction d’un autre utilisateur', async () => {
    const foreign = await createExpense(other.token);

    for (const response of [
      await getExpenseRoute(
        apiRequest(`/api/expenses/${foreign.id}`, { token: session.token }),
        context(foreign.id),
      ),
      await patchExpenseRoute(
        apiRequest(`/api/expenses/${foreign.id}`, {
          method: 'PATCH',
          token: session.token,
          body: { notes: 'tentative' },
        }),
        context(foreign.id),
      ),
      await deleteExpenseRoute(
        apiRequest(`/api/expenses/${foreign.id}`, { method: 'DELETE', token: session.token }),
        context(foreign.id),
      ),
    ]) {
      expect(await expectErrorCode(response)).toBe('NOT_FOUND');
    }

    // Rien n'a bougé chez le voisin.
    expect(tables.expense.rows).toHaveLength(1);
  });

  it('ne liste que les transactions de la session', async () => {
    await createExpense(other.token);
    await createExpense(session.token);

    const { expenses } = await expectSuccess<{ expenses: ExpenseDto[] }>(
      await listExpensesRoute(apiRequest('/api/expenses', { token: session.token })),
    );

    expect(expenses).toHaveLength(1);
  });
});
