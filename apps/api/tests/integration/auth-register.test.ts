import type { AuthenticatedSessionDto } from '@subscription-manager/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { POST as register } from '@/app/api/auth/register/route';
import { resetRateLimits } from '@/lib/security/rate-limit';

import { registerInput, VALID_PASSWORD } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/** POST /api/auth/register — `specs/auth-comptes-rgpd.md` §2, §4, §7. */
describe('POST /api/auth/register', () => {
  beforeEach(() => {
    resetDatabase();
    resetRateLimits();
  });

  it('crée le compte, ouvre une session et renvoie le token une seule fois', async () => {
    const response = await register(
      apiRequest('/api/auth/register', { method: 'POST', body: registerInput() }),
    );

    expect(response.status).toBe(201);

    const data = await expectSuccess<AuthenticatedSessionDto>(response);

    expect(data.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(data.user.email).toBe('utilisateur@example.com');
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(tables.user.rows).toHaveLength(1);
    expect(tables.authSession.rows).toHaveLength(1);
  });

  it('ne renvoie jamais le hash du mot de passe', async () => {
    const response = await register(
      apiRequest('/api/auth/register', { method: 'POST', body: registerInput() }),
    );
    const body = await response.text();

    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('$argon2id$');
    expect(body).not.toContain(VALID_PASSWORD);
  });

  it('stocke le mot de passe haché, jamais en clair', async () => {
    await register(apiRequest('/api/auth/register', { method: 'POST', body: registerInput() }));

    const stored = tables.user.rows[0] as { passwordHash: string } | undefined;

    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored?.passwordHash).not.toContain(VALID_PASSWORD);
  });

  it('ne stocke jamais le token de session en clair', async () => {
    const response = await register(
      apiRequest('/api/auth/register', { method: 'POST', body: registerInput() }),
    );
    const { token } = await expectSuccess<AuthenticatedSessionDto>(response);
    const session = tables.authSession.rows[0] as { tokenHash: string } | undefined;

    expect(session?.tokenHash).toHaveLength(64);
    expect(session?.tokenHash).not.toBe(token);
  });

  it("normalise l'adresse e-mail en minuscules", async () => {
    const response = await register(
      apiRequest('/api/auth/register', {
        method: 'POST',
        body: registerInput({ email: 'Utilisateur@Example.COM' }),
      }),
    );

    const data = await expectSuccess<AuthenticatedSessionDto>(response);

    expect(data.user.email).toBe('utilisateur@example.com');
  });

  it("conserve les préférences choisies pendant l'onboarding, sans les déduire", async () => {
    // Cas valide et explicitement testé par CLAUDE.md §4 : langue française,
    // pays américain, devise américaine.
    const response = await register(
      apiRequest('/api/auth/register', {
        method: 'POST',
        body: registerInput({ language: 'fr', country: 'US', currency: 'USD' }),
      }),
    );

    const data = await expectSuccess<AuthenticatedSessionDto>(response);

    expect(data.user.language).toBe('fr');
    expect(data.user.country).toBe('US');
    expect(data.user.currency).toBe('USD');
  });

  it('refuse une adresse déjà utilisée, quelle que soit la casse', async () => {
    await register(apiRequest('/api/auth/register', { method: 'POST', body: registerInput() }));

    const response = await register(
      apiRequest('/api/auth/register', {
        method: 'POST',
        body: registerInput({ email: 'UTILISATEUR@example.com' }),
      }),
    );

    expect(await expectErrorCode(response)).toBe('AUTH_EMAIL_ALREADY_EXISTS');
    expect(response.status).toBe(409);
    expect(tables.user.rows).toHaveLength(1);
  });

  it('rejette un mot de passe trop court avec VALIDATION_ERROR', async () => {
    const response = await register(
      apiRequest('/api/auth/register', {
        method: 'POST',
        body: registerInput({ password: 'court' }),
      }),
    );

    expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
    expect(response.status).toBe(400);
    expect(tables.user.rows).toHaveLength(0);
  });

  it('rejette un pays ou une devise hors référentiel', async () => {
    const paysInvalide = await register(
      apiRequest('/api/auth/register', {
        method: 'POST',
        body: { ...registerInput(), country: 'XX' },
      }),
    );
    const deviseInvalide = await register(
      apiRequest('/api/auth/register', {
        method: 'POST',
        body: { ...registerInput(), currency: 'CHF' },
      }),
    );

    expect(await expectErrorCode(paysInvalide)).toBe('VALIDATION_ERROR');
    expect(await expectErrorCode(deviseInvalide)).toBe('VALIDATION_ERROR');
  });

  it('rejette un corps JSON invalide', async () => {
    const request = new Request('https://api.test/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'ceci-n-est-pas-du-json',
    });

    expect(await expectErrorCode(await register(request))).toBe('VALIDATION_ERROR');
  });

  it('accepte les fournisseurs e-mail listés par la spec §2', async () => {
    const providers = ['a@gmail.com', 'b@proton.me', 'c@tutanota.com', 'd@laposte.net'];

    for (const [index, email] of providers.entries()) {
      const response = await register(
        apiRequest('/api/auth/register', {
          method: 'POST',
          body: registerInput({ email }),
          // IP distincte : le rate limiting d'inscription est par IP.
          headers: { 'x-forwarded-for': `10.1.0.${String(index + 1)}` },
        }),
      );

      expect(response.status).toBe(201);
    }

    expect(tables.user.rows).toHaveLength(providers.length);
  });
});
