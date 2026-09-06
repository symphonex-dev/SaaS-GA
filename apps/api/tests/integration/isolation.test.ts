import type {
  AuthenticatedSessionDto,
  UserDataExport,
  UserDto,
} from '@subscription-manager/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { GET as exportAccount } from '@/app/api/account/export/route';
import { GET as me } from '@/app/api/account/me/route';
import { PATCH as updatePreferences } from '@/app/api/account/preferences/route';
import { DELETE as deleteAccount } from '@/app/api/account/route';
import { resetRateLimits } from '@/lib/security/rate-limit';

import { attachExpense, attachSubscription, createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/**
 * Isolation multi-utilisateur — `specs/auth-comptes-rgpd.md` §11.
 *
 * Périmètre couvert ici : les routes existantes à ce stade (compte, export,
 * préférences, suppression, abonnement). Les points de la checklist §11 qui
 * portent sur les dépenses, les imports, les détections, les objectifs
 * d'épargne et les appels IA seront couverts avec les routes correspondantes
 * (phases 3, 4, 6 et 7) — elles n'existent pas encore.
 */
describe('isolation entre utilisateurs', () => {
  let userA: AuthenticatedSessionDto;
  let userB: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();
    userA = await createUserWithSession({ email: 'a@example.com' });
    userB = await createUserWithSession({
      email: 'b@example.com',
      language: 'es',
      country: 'ES',
      currency: 'GBP',
    });

    attachExpense(userA.user.id, 'NETFLIX.COM');
    attachExpense(userB.user.id, 'SPOTIFY');
    attachSubscription(userB.user.id, { plan: 'PLUS', status: 'ACTIVE' });
  });

  it('le token de A ne donne jamais accès au profil de B', async () => {
    const data = await expectSuccess<{ user: UserDto }>(
      await me(apiRequest('/api/account/me', { token: userA.token })),
    );

    expect(data.user.email).toBe('a@example.com');
    expect(data.user.id).not.toBe(userB.user.id);
  });

  it('A ne peut pas lire les dépenses de B via son export', async () => {
    const response = await exportAccount(apiRequest('/api/account/export', { token: userA.token }));
    const data = (await response.json()) as UserDataExport;
    const marchands = (data.expenses as { merchantRaw: string }[]).map((e) => e.merchantRaw);

    expect(marchands).toEqual(['NETFLIX.COM']);
  });

  it("A ne peut pas consulter l'abonnement de B", async () => {
    const response = await exportAccount(apiRequest('/api/account/export', { token: userA.token }));
    const data = (await response.json()) as UserDataExport;

    expect(data.subscription).toBeNull();
  });

  it('A ne peut pas modifier les préférences de B', async () => {
    await updatePreferences(
      apiRequest('/api/account/preferences', {
        method: 'PATCH',
        token: userA.token,
        body: { language: 'en', country: 'US', currency: 'USD', userId: userB.user.id },
      }),
    );

    const cible = tables.user.rows.find((row) => row['id'] === userB.user.id) as {
      language: string;
      currency: string;
    };

    expect(cible.language).toBe('es');
    expect(cible.currency).toBe('GBP');
  });

  it('A ne peut pas supprimer le compte de B', async () => {
    await deleteAccount(
      apiRequest('/api/account', {
        method: 'DELETE',
        token: userA.token,
        body: { confirmation: 'DELETE_MY_ACCOUNT', userId: userB.user.id },
      }),
    );

    // Le compte supprimé est bien celui de la session, jamais celui visé par le corps.
    expect(tables.user.rows.some((row) => row['id'] === userB.user.id)).toBe(true);
    expect(tables.user.rows.some((row) => row['id'] === userA.user.id)).toBe(false);
    expect(tables.expense.rows.filter((row) => row['userId'] === userB.user.id)).toHaveLength(1);
  });

  it('une session révoquée de A ne redonne jamais accès aux données', async () => {
    const sessionA = tables.authSession.rows.find((row) => row['userId'] === userA.user.id) as {
      revokedAt: Date | null;
    };
    sessionA.revokedAt = new Date();

    const response = await me(apiRequest('/api/account/me', { token: userA.token }));

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });
});
