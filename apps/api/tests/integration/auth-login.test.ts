import type { AuthenticatedSessionDto } from '@subscription-manager/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { POST as login } from '@/app/api/auth/login/route';
import { getRateLimitRule, resetRateLimits } from '@/lib/security/rate-limit';

import { createUserWithSession, VALID_PASSWORD } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess, readApiResponse } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/** POST /api/auth/login — `specs/auth-comptes-rgpd.md` §4. */
describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();
    await createUserWithSession({ email: 'connexion@example.com' });
  });

  const credentials = { email: 'connexion@example.com', password: VALID_PASSWORD };

  it('ouvre une nouvelle session avec des identifiants valides', async () => {
    const sessionsAvant = tables.authSession.rows.length;

    const response = await login(
      apiRequest('/api/auth/login', { method: 'POST', body: credentials }),
    );
    const data = await expectSuccess<AuthenticatedSessionDto>(response);

    expect(response.status).toBe(200);
    expect(data.token.length).toBeGreaterThan(20);
    expect(data.user.email).toBe('connexion@example.com');
    expect(tables.authSession.rows).toHaveLength(sessionsAvant + 1);
  });

  it('accepte une adresse saisie avec une casse différente', async () => {
    const response = await login(
      apiRequest('/api/auth/login', {
        method: 'POST',
        body: { ...credentials, email: 'Connexion@Example.com' },
      }),
    );

    expect(response.status).toBe(200);
  });

  it('renvoie la même erreur pour un e-mail inconnu et un mot de passe erroné', async () => {
    const inconnu = await login(
      apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email: 'inexistant@example.com', password: VALID_PASSWORD },
        headers: { 'x-forwarded-for': '10.2.0.1' },
      }),
    );
    const mauvaisMotDePasse = await login(
      apiRequest('/api/auth/login', {
        method: 'POST',
        body: { ...credentials, password: 'MauvaisMotDePasse2026' },
        headers: { 'x-forwarded-for': '10.2.0.2' },
      }),
    );

    const corpsInconnu = await readApiResponse(inconnu);
    const corpsMauvais = await readApiResponse(mauvaisMotDePasse);

    // Ni le code, ni le message, ni le statut ne permettent de distinguer les
    // deux cas : aucune énumération de comptes possible.
    expect(corpsInconnu).toEqual(corpsMauvais);
    expect(inconnu.status).toBe(mauvaisMotDePasse.status);
    expect(inconnu.status).toBe(401);
  });

  it("n'ouvre aucune session en cas d'échec", async () => {
    const sessionsAvant = tables.authSession.rows.length;

    await login(
      apiRequest('/api/auth/login', {
        method: 'POST',
        body: { ...credentials, password: 'MauvaisMotDePasse2026' },
      }),
    );

    expect(tables.authSession.rows).toHaveLength(sessionsAvant);
  });

  it("n'impose pas de longueur minimale de mot de passe à la connexion", async () => {
    // Une erreur de validation distincte révélerait la politique appliquée au
    // compte ciblé : un mot de passe court doit produire AUTH_INVALID_CREDENTIALS.
    const response = await login(
      apiRequest('/api/auth/login', { method: 'POST', body: { ...credentials, password: 'x' } }),
    );

    expect(await expectErrorCode(response)).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it("enregistre le libellé d'appareil transmis par le client", async () => {
    await login(
      apiRequest('/api/auth/login', {
        method: 'POST',
        body: credentials,
        // Les en-têtes HTTP sont ASCII : le libellé est encodé en pourcent.
        headers: { 'x-device-label': encodeURIComponent('Android — Pixel 8') },
      }),
    );

    const derniere = tables.authSession.rows.at(-1) as { deviceLabel: string | null } | undefined;

    expect(derniere?.deviceLabel).toBe('Android — Pixel 8');
  });

  it('applique le rate limiting par IP', async () => {
    const { limit } = getRateLimitRule('auth:login');

    for (let attempt = 0; attempt < limit; attempt += 1) {
      await login(
        apiRequest('/api/auth/login', {
          method: 'POST',
          body: { ...credentials, password: 'MauvaisMotDePasse2026' },
          headers: { 'x-forwarded-for': '10.3.0.1' },
        }),
      );
    }

    const bloque = await login(
      apiRequest('/api/auth/login', {
        method: 'POST',
        body: credentials,
        headers: { 'x-forwarded-for': '10.3.0.1' },
      }),
    );

    expect(await expectErrorCode(bloque)).toBe('RATE_LIMITED');
    expect(bloque.status).toBe(429);
  });

  it('refuse la connexion à un compte supprimé (deletedAt renseigné)', async () => {
    const user = tables.user.rows[0] as { deletedAt: Date | null };
    user.deletedAt = new Date();

    const response = await login(
      apiRequest('/api/auth/login', { method: 'POST', body: credentials }),
    );

    expect(await expectErrorCode(response)).toBe('AUTH_INVALID_CREDENTIALS');
  });
});
