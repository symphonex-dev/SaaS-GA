import type { AuthenticatedSessionDto, AuthenticatedUser } from '@subscription-manager/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { POST as logout } from '@/app/api/auth/logout/route';
import { GET as session } from '@/app/api/auth/session/route';
import { GET as me } from '@/app/api/account/me/route';
import { resetRateLimits } from '@/lib/security/rate-limit';
import { hashSessionToken } from '@/lib/security/tokens';

import { createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/**
 * Cycle de vie de la session (`specs/auth-comptes-rgpd.md` §1 et §4) et garde
 * `requireUser()` : aucune route fonctionnelle n'est accessible sans session
 * valide (CLAUDE.md §5.14).
 */
describe('session par token opaque', () => {
  let created: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();
    created = await createUserWithSession({ email: 'session@example.com' });
  });

  function storedSession(): { revokedAt: Date | null; expiresAt: Date; lastUsedAt: Date } {
    const row = tables.authSession.rows.find(
      (candidate) => candidate['tokenHash'] === hashSessionToken(created.token),
    );

    if (row === undefined) {
      throw new Error('Session de test introuvable.');
    }

    return row as unknown as { revokedAt: Date | null; expiresAt: Date; lastUsedAt: Date };
  }

  it('valide un token actif', async () => {
    const response = await session(apiRequest('/api/auth/session', { token: created.token }));
    const data = await expectSuccess<{ user: AuthenticatedUser }>(response);

    expect(data.user.email).toBe('session@example.com');
    expect(data.user).not.toHaveProperty('passwordHash');
  });

  it('refuse une requête sans en-tête Authorization', async () => {
    const response = await session(apiRequest('/api/auth/session'));

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
    expect(response.status).toBe(401);
  });

  it.each([
    ['un schéma inconnu', { authorization: `Basic ${'abc'}` }],
    ['un en-tête vide', { authorization: '' }],
    ['un token vide', { authorization: 'Bearer ' }],
  ])('refuse %s', async (_label, headers) => {
    const response = await session(apiRequest('/api/auth/session', { headers }));

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });

  it('refuse un token inconnu', async () => {
    const response = await session(apiRequest('/api/auth/session', { token: 'token-inexistant' }));

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });

  it('refuse une session expirée', async () => {
    storedSession().expiresAt = new Date(Date.now() - 1000);

    const response = await session(apiRequest('/api/auth/session', { token: created.token }));

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });

  it('refuse une session révoquée', async () => {
    storedSession().revokedAt = new Date();

    const response = await session(apiRequest('/api/auth/session', { token: created.token }));

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });

  it("refuse la session d'un compte supprimé", async () => {
    (tables.user.rows[0] as { deletedAt: Date | null }).deletedAt = new Date();

    const response = await session(apiRequest('/api/auth/session', { token: created.token }));

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });

  it("met à jour lastUsedAt et repousse l'expiration à chaque usage", async () => {
    const avant = storedSession();
    avant.lastUsedAt = new Date(Date.now() - 60_000);
    avant.expiresAt = new Date(Date.now() + 1000);

    await session(apiRequest('/api/auth/session', { token: created.token }));

    const apres = storedSession();

    expect(apres.lastUsedAt.getTime()).toBeGreaterThan(Date.now() - 5000);
    expect(apres.expiresAt.getTime()).toBeGreaterThan(Date.now() + 60_000);
  });

  it('révoque la session à la déconnexion et rend le token inutilisable', async () => {
    const deconnexion = await logout(
      apiRequest('/api/auth/logout', { method: 'POST', token: created.token }),
    );

    expect(deconnexion.status).toBe(200);
    expect(storedSession().revokedAt).not.toBeNull();

    const apres = await session(apiRequest('/api/auth/session', { token: created.token }));

    expect(await expectErrorCode(apres)).toBe('AUTH_UNAUTHORIZED');
  });

  it('refuse une déconnexion sans session valide', async () => {
    const response = await logout(apiRequest('/api/auth/logout', { method: 'POST' }));

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });

  it('protège aussi les routes de compte (aucun aperçu sans session)', async () => {
    const response = await me(apiRequest('/api/account/me'));

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });

  it("n'affecte pas les autres sessions du même utilisateur à la déconnexion", async () => {
    const seconde = await createUserWithSession({ email: 'autre-appareil@example.com' });

    await logout(apiRequest('/api/auth/logout', { method: 'POST', token: created.token }));

    const encoreValide = await session(apiRequest('/api/auth/session', { token: seconde.token }));

    expect(encoreValide.status).toBe(200);
  });
});
