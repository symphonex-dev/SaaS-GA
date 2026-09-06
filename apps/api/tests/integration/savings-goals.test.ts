import type { AuthenticatedSessionDto, UserSavingsGoalDto } from '@subscription-manager/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { DELETE as deleteGoalRoute, PATCH as patchGoalRoute } from '@/app/api/savings/[id]/route';
import { GET as listGoalsRoute, POST as createGoalRoute } from '@/app/api/savings/route';
import { resetRateLimits } from '@/lib/security/rate-limit';

import { attachSubscription, createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/**
 * Objectifs d'épargne (`specs/ui-composants-mobile.md` §8,
 * `specs/calculs-financiers.md` §6).
 *
 * Règle produit vérifiée ici : une économie ne devient **confirmée** que sur
 * action explicite de l'utilisateur. Le plafond d'objectifs vient de l'offre
 * (`specs/paiement-in-app.md` §2), contrôle exclusivement serveur.
 */
const GOAL = { targetAmount: { minorUnits: '20000', currency: 'EUR' } };

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('objectifs d’épargne', () => {
  let session: AuthenticatedSessionDto;
  let other: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();

    session = await createUserWithSession({ email: 'epargne@example.com' });
    other = await createUserWithSession({ email: 'voisin@example.com' });
  });

  async function createGoal(token: string): Promise<UserSavingsGoalDto> {
    const { goal } = await expectSuccess<{ goal: UserSavingsGoalDto }>(
      await createGoalRoute(apiRequest('/api/savings', { method: 'POST', token, body: GOAL })),
    );

    return goal;
  }

  it('exige une session valide', async () => {
    const response = await createGoalRoute(
      apiRequest('/api/savings', { method: 'POST', body: GOAL }),
    );

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });

  it('crée un objectif à zéro : rien n’est confirmé d’office', async () => {
    const goal = await createGoal(session.token);

    expect(goal.targetAmount.minorUnits).toBe('20000');
    // Le montant atteint ne peut venir que d'une action explicite (§6).
    expect(goal.achievedAmount.minorUnits).toBe('0');
    expect(goal.status).toBe('ACTIVE');
  });

  it('plafonne le nombre d’objectifs selon l’offre', async () => {
    // L'offre Free autorise un seul objectif (`savingsGoalsLimit: 1`).
    await createGoal(session.token);

    const response = await createGoalRoute(
      apiRequest('/api/savings', { method: 'POST', token: session.token, body: GOAL }),
    );

    expect(await expectErrorCode(response)).toBe('IMPORT_QUOTA_REACHED');
    expect(tables.userSavingsGoal.rows).toHaveLength(1);
  });

  it('lève le plafond pour un abonnement Plus actif', async () => {
    attachSubscription(session.user.id, {
      plan: 'PLUS',
      status: 'ACTIVE',
      currentPeriodEnd: new Date('2099-01-01T00:00:00.000Z'),
    });

    await createGoal(session.token);
    await createGoal(session.token);

    expect(tables.userSavingsGoal.rows).toHaveLength(2);
  });

  it('refuse un objectif dans une autre devise que le compte', async () => {
    const response = await createGoalRoute(
      apiRequest('/api/savings', {
        method: 'POST',
        token: session.token,
        body: { targetAmount: { minorUnits: '20000', currency: 'USD' } },
      }),
    );

    expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
  });

  it('confirme une économie et bascule en REACHED une fois la cible atteinte', async () => {
    const created = await createGoal(session.token);

    const { goal: partial } = await expectSuccess<{ goal: UserSavingsGoalDto }>(
      await patchGoalRoute(
        apiRequest(`/api/savings/${created.id}`, {
          method: 'PATCH',
          token: session.token,
          body: { achievedAmount: { minorUnits: '9600', currency: 'EUR' } },
        }),
        context(created.id),
      ),
    );

    expect(partial.achievedAmount.minorUnits).toBe('9600');
    expect(partial.status).toBe('ACTIVE');

    const { goal: reached } = await expectSuccess<{ goal: UserSavingsGoalDto }>(
      await patchGoalRoute(
        apiRequest(`/api/savings/${created.id}`, {
          method: 'PATCH',
          token: session.token,
          body: { achievedAmount: { minorUnits: '20000', currency: 'EUR' } },
        }),
        context(created.id),
      ),
    );

    expect(reached.status).toBe('REACHED');
  });

  it('refuse un montant atteint supérieur à la cible', async () => {
    const created = await createGoal(session.token);

    const response = await patchGoalRoute(
      apiRequest(`/api/savings/${created.id}`, {
        method: 'PATCH',
        token: session.token,
        body: { achievedAmount: { minorUnits: '30000', currency: 'EUR' } },
      }),
      context(created.id),
    );

    expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
  });

  it('refuse de changer la devise d’un objectif existant', async () => {
    const created = await createGoal(session.token);

    const response = await patchGoalRoute(
      apiRequest(`/api/savings/${created.id}`, {
        method: 'PATCH',
        token: session.token,
        body: { targetAmount: { minorUnits: '25000', currency: 'USD' } },
      }),
      context(created.id),
    );

    expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
  });

  it('ne réactive jamais automatiquement un objectif abandonné', async () => {
    const created = await createGoal(session.token);

    await patchGoalRoute(
      apiRequest(`/api/savings/${created.id}`, {
        method: 'PATCH',
        token: session.token,
        body: { status: 'ABANDONED' },
      }),
      context(created.id),
    );

    const { goal } = await expectSuccess<{ goal: UserSavingsGoalDto }>(
      await patchGoalRoute(
        apiRequest(`/api/savings/${created.id}`, {
          method: 'PATCH',
          token: session.token,
          body: { achievedAmount: { minorUnits: '20000', currency: 'EUR' } },
        }),
        context(created.id),
      ),
    );

    expect(goal.status).toBe('ABANDONED');
  });

  it('traite comme inexistant l’objectif d’un autre utilisateur', async () => {
    const foreign = await createGoal(other.token);

    for (const response of [
      await patchGoalRoute(
        apiRequest(`/api/savings/${foreign.id}`, {
          method: 'PATCH',
          token: session.token,
          body: { achievedAmount: { minorUnits: '100', currency: 'EUR' } },
        }),
        context(foreign.id),
      ),
      await deleteGoalRoute(
        apiRequest(`/api/savings/${foreign.id}`, { method: 'DELETE', token: session.token }),
        context(foreign.id),
      ),
    ]) {
      expect(await expectErrorCode(response)).toBe('NOT_FOUND');
    }

    expect(tables.userSavingsGoal.rows).toHaveLength(1);
  });

  it('ne liste que les objectifs de la session', async () => {
    await createGoal(other.token);
    await createGoal(session.token);

    const { goals } = await expectSuccess<{ goals: UserSavingsGoalDto[] }>(
      await listGoalsRoute(apiRequest('/api/savings', { token: session.token })),
    );

    expect(goals).toHaveLength(1);
  });
});
