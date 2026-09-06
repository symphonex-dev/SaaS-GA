import type { AuthenticatedSessionDto } from '@subscription-manager/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { DELETE as deleteAccount } from '@/app/api/account/route';
import { GET as session } from '@/app/api/auth/session/route';
import { resetRateLimits } from '@/lib/security/rate-limit';

import { attachExpense, attachSubscription, createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/** DELETE /api/account — `specs/auth-comptes-rgpd.md` §9, CLAUDE.md §5.9. */
const CONFIRMATION = { confirmation: 'DELETE_MY_ACCOUNT' };

describe('suppression de compte', () => {
  let compte: AuthenticatedSessionDto;
  let voisin: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();
    compte = await createUserWithSession({ email: 'suppression@example.com' });
    voisin = await createUserWithSession({ email: 'voisin@example.com' });
    attachExpense(compte.user.id, 'NETFLIX.COM');
    attachExpense(voisin.user.id, 'SPOTIFY');
  });

  function supprimer(token: string, body: unknown = CONFIRMATION): Promise<Response> {
    return deleteAccount(apiRequest('/api/account', { method: 'DELETE', token, body }));
  }

  it('supprime le compte sans abonnement', async () => {
    const response = await supprimer(compte.token);

    expect(response.status).toBe(200);
    expect(tables.user.rows.some((row) => row['email'] === 'suppression@example.com')).toBe(false);
  });

  it('supprime en cascade toutes les données du compte', async () => {
    await supprimer(compte.token);

    expect(tables.expense.rows.filter((row) => row['userId'] === compte.user.id)).toHaveLength(0);
    expect(tables.authSession.rows.filter((row) => row['userId'] === compte.user.id)).toHaveLength(
      0,
    );
    expect(
      tables.passwordResetToken.rows.filter((row) => row['userId'] === compte.user.id),
    ).toHaveLength(0);
    expect(tables.subscription.rows.filter((row) => row['userId'] === compte.user.id)).toHaveLength(
      0,
    );
  });

  it("n'affecte aucune donnée d'un autre utilisateur", async () => {
    await supprimer(compte.token);

    expect(tables.user.rows.some((row) => row['email'] === 'voisin@example.com')).toBe(true);
    expect(tables.expense.rows.filter((row) => row['userId'] === voisin.user.id)).toHaveLength(1);

    const sessionVoisin = await session(apiRequest('/api/auth/session', { token: voisin.token }));

    expect(sessionVoisin.status).toBe(200);
  });

  it('invalide immédiatement la session utilisée pour supprimer', async () => {
    await supprimer(compte.token);

    const apres = await session(apiRequest('/api/auth/session', { token: compte.token }));

    expect(await expectErrorCode(apres)).toBe('AUTH_UNAUTHORIZED');
  });

  it('exige la confirmation exacte', async () => {
    const sansConfirmation = await supprimer(compte.token, {});
    const mauvaise = await supprimer(compte.token, { confirmation: 'SUPPRIMER' });

    expect(await expectErrorCode(sansConfirmation)).toBe('VALIDATION_ERROR');
    expect(await expectErrorCode(mauvaise)).toBe('VALIDATION_ERROR');
    expect(tables.user.rows.some((row) => row['email'] === 'suppression@example.com')).toBe(true);
  });

  it('refuse la suppression sans session', async () => {
    const response = await deleteAccount(
      apiRequest('/api/account', { method: 'DELETE', body: CONFIRMATION }),
    );

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });

  it('bloque la suppression avec un abonnement payant actif non résilié', async () => {
    attachSubscription(compte.user.id, {
      plan: 'PLUS',
      status: 'ACTIVE',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date('2026-12-31T00:00:00.000Z'),
    });

    const response = await supprimer(compte.token);

    expect(await expectErrorCode(response)).toBe('ACCOUNT_DELETION_BLOCKED_ACTIVE_SUBSCRIPTION');
    expect(response.status).toBe(409);
    expect(tables.user.rows.some((row) => row['email'] === 'suppression@example.com')).toBe(true);
  });

  it('ne révoque pas la session quand la suppression est bloquée', async () => {
    attachSubscription(compte.user.id, { plan: 'PLUS', status: 'ACTIVE' });

    await supprimer(compte.token);
    const encoreValide = await session(apiRequest('/api/auth/session', { token: compte.token }));

    expect(encoreValide.status).toBe(200);
  });

  it('autorise la suppression dès la résiliation, sans attendre la fin de période', async () => {
    attachSubscription(compte.user.id, {
      plan: 'PLUS',
      status: 'ACTIVE',
      cancelAtPeriodEnd: true,
      // Accès payant encore ouvert : la suppression reste autorisée.
      currentPeriodEnd: new Date('2026-12-31T00:00:00.000Z'),
    });

    const response = await supprimer(compte.token);

    expect(response.status).toBe(200);
    expect(tables.user.rows.some((row) => row['email'] === 'suppression@example.com')).toBe(false);
  });

  it('autorise la suppression sur le plan FREE et après expiration', async () => {
    attachSubscription(compte.user.id, { plan: 'FREE', status: 'ACTIVE' });
    attachSubscription(voisin.user.id, { plan: 'PLUS', status: 'EXPIRED' });

    expect((await supprimer(compte.token)).status).toBe(200);
    expect((await supprimer(voisin.token)).status).toBe(200);
    expect(tables.user.rows).toHaveLength(0);
  });

  it("empêche définitivement l'authentification après suppression", async () => {
    await supprimer(compte.token);

    const response = await session(apiRequest('/api/auth/session', { token: compte.token }));

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });
});
