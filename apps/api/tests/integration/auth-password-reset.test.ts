import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as login } from '@/app/api/auth/login/route';
import { POST as requestReset } from '@/app/api/auth/request-password-reset/route';
import { POST as resetPassword } from '@/app/api/auth/reset-password/route';
import { GET as session } from '@/app/api/auth/session/route';
import { resetRateLimits } from '@/lib/security/rate-limit';
import { hashPasswordResetToken } from '@/lib/security/tokens';
import { MailDeliveryError, getMailer, setMailerForTests } from '@/lib/mail/mailer';

import { createUserWithSession, VALID_PASSWORD } from '../helpers/factories';
import { apiRequest, expectErrorCode, readApiResponse } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/**
 * Réinitialisation de mot de passe — `specs/auth-comptes-rgpd.md` §5.
 *
 * Le token brut ne transitant que par e-mail, les tests le récupèrent en
 * espionnant l'appel au service d'envoi.
 */
const NOUVEAU_MOT_DE_PASSE = 'NouveauMotDePasse2026';

async function demanderTokenBrut(email: string): Promise<string> {
  const capturés: string[] = [];
  const mailer = getMailer();

  const envoi = vi.spyOn(mailer, 'sendPasswordReset').mockImplementation(async ({ resetUrl }) => {
    const token = /token=([^&]+)/.exec(resetUrl)?.[1];

    if (token !== undefined) {
      capturés.push(decodeURIComponent(token));
    }

    await Promise.resolve();
  });

  await requestReset(
    apiRequest('/api/auth/request-password-reset', { method: 'POST', body: { email } }),
  );

  envoi.mockRestore();

  const token = capturés.at(-1);

  if (token === undefined) {
    throw new Error("Aucun lien de réinitialisation n'a été envoyé.");
  }

  return token;
}

describe('réinitialisation de mot de passe', () => {
  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();
    vi.restoreAllMocks();
    await createUserWithSession({ email: 'reset@example.com' });
  });

  it('répond le même message générique pour un compte connu et inconnu', async () => {
    const connu = await requestReset(
      apiRequest('/api/auth/request-password-reset', {
        method: 'POST',
        body: { email: 'reset@example.com' },
        headers: { 'x-forwarded-for': '10.4.0.1' },
      }),
    );
    const inconnu = await requestReset(
      apiRequest('/api/auth/request-password-reset', {
        method: 'POST',
        body: { email: 'jamais-inscrit@example.com' },
        headers: { 'x-forwarded-for': '10.4.0.2' },
      }),
    );

    expect(connu.status).toBe(inconnu.status);
    expect(await readApiResponse(connu)).toEqual(await readApiResponse(inconnu));
  });

  it('ne crée aucun token pour une adresse inconnue', async () => {
    await requestReset(
      apiRequest('/api/auth/request-password-reset', {
        method: 'POST',
        body: { email: 'jamais-inscrit@example.com' },
      }),
    );

    expect(tables.passwordResetToken.rows).toHaveLength(0);
  });

  it("ne stocke que l'empreinte du token, jamais le token brut", async () => {
    const token = await demanderTokenBrut('reset@example.com');
    const stocké = tables.passwordResetToken.rows[0] as { tokenHash: string };

    expect(stocké.tokenHash).toBe(hashPasswordResetToken(token));
    expect(stocké.tokenHash).not.toBe(token);
    expect(JSON.stringify(tables.passwordResetToken.rows)).not.toContain(token);
  });

  it('change le mot de passe et permet de se reconnecter avec le nouveau', async () => {
    const token = await demanderTokenBrut('reset@example.com');

    const reset = await resetPassword(
      apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: { token, password: NOUVEAU_MOT_DE_PASSE },
      }),
    );

    expect(reset.status).toBe(200);

    const ancien = await login(
      apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email: 'reset@example.com', password: VALID_PASSWORD },
        headers: { 'x-forwarded-for': '10.4.1.1' },
      }),
    );
    const nouveau = await login(
      apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email: 'reset@example.com', password: NOUVEAU_MOT_DE_PASSE },
        headers: { 'x-forwarded-for': '10.4.1.2' },
      }),
    );

    expect(await expectErrorCode(ancien)).toBe('AUTH_INVALID_CREDENTIALS');
    expect(nouveau.status).toBe(200);
  });

  it('interdit de réutiliser un token déjà consommé', async () => {
    const token = await demanderTokenBrut('reset@example.com');

    await resetPassword(
      apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: { token, password: NOUVEAU_MOT_DE_PASSE },
      }),
    );

    const seconde = await resetPassword(
      apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: { token, password: 'EncoreUnAutreMdp2026' },
      }),
    );

    expect(await expectErrorCode(seconde)).toBe('AUTH_RESET_TOKEN_INVALID');
  });

  it('rejette un token expiré avec un code distinct', async () => {
    const token = await demanderTokenBrut('reset@example.com');
    (tables.passwordResetToken.rows[0] as { expiresAt: Date }).expiresAt = new Date(
      Date.now() - 1000,
    );

    const response = await resetPassword(
      apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: { token, password: NOUVEAU_MOT_DE_PASSE },
      }),
    );

    expect(await expectErrorCode(response)).toBe('AUTH_RESET_TOKEN_EXPIRED');
  });

  it('rejette un token inconnu', async () => {
    const response = await resetPassword(
      apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: { token: 'token-invente', password: NOUVEAU_MOT_DE_PASSE },
      }),
    );

    expect(await expectErrorCode(response)).toBe('AUTH_RESET_TOKEN_INVALID');
  });

  it('invalide les demandes précédentes quand une nouvelle est émise', async () => {
    const premier = await demanderTokenBrut('reset@example.com');
    await demanderTokenBrut('reset@example.com');

    const response = await resetPassword(
      apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: { token: premier, password: NOUVEAU_MOT_DE_PASSE },
      }),
    );

    expect(await expectErrorCode(response)).toBe('AUTH_RESET_TOKEN_INVALID');
  });

  it('révoque toutes les sessions existantes après un changement de mot de passe', async () => {
    const sessionExistante = await createUserWithSession({ email: 'reset2@example.com' });
    const token = await demanderTokenBrut('reset2@example.com');

    await resetPassword(
      apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: { token, password: NOUVEAU_MOT_DE_PASSE },
      }),
    );

    const response = await session(
      apiRequest('/api/auth/session', { token: sessionExistante.token }),
    );

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });

  it('refuse un nouveau mot de passe trop court', async () => {
    const token = await demanderTokenBrut('reset@example.com');

    const response = await resetPassword(
      apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: { token, password: 'court' },
      }),
    );

    expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
  });
});

/**
 * Aucune énumération de comptes par le comportement de l'envoi (§5).
 *
 * La route n'appelle le transport que lorsque le compte existe : si un échec
 * d'envoi remontait, le code de réponse deviendrait un oracle — 200 pour une
 * adresse inconnue, 500 pour une adresse connue. La panne est donc absorbée et
 * la réponse reste rigoureusement identique.
 */
describe('échec d’envoi et énumération de comptes', () => {
  beforeEach(() => {
    resetDatabase();
    resetRateLimits();
    setMailerForTests(null);
  });

  it('répond exactement pareil que le compte existe ou non, même si l’envoi échoue', async () => {
    await createUserWithSession({ email: 'connu@example.com' });

    setMailerForTests({
      sendPasswordReset: () => Promise.reject(new MailDeliveryError('Le fournisseur a refusé.')),
    });

    const journal = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const connu = await requestReset(
      apiRequest('/api/auth/request-password-reset', {
        method: 'POST',
        body: { email: 'connu@example.com' },
      }),
    );
    const inconnu = await requestReset(
      apiRequest('/api/auth/request-password-reset', {
        method: 'POST',
        body: { email: 'inconnu@example.com' },
      }),
    );

    expect(connu.status).toBe(inconnu.status);
    expect(await readApiResponse(connu)).toEqual(await readApiResponse(inconnu));

    // L'incident est bien signalé — mais sans adresse, sans lien, sans token.
    expect(journal).toHaveBeenCalledTimes(1);

    const message = String(journal.mock.calls[0]?.[0]);

    expect(message).not.toContain('connu@example.com');
    expect(message).not.toContain('token');

    journal.mockRestore();
    setMailerForTests(null);
  });

  it('n’enregistre pas moins de token parce que l’envoi a échoué', async () => {
    await createUserWithSession({ email: 'connu2@example.com' });

    setMailerForTests({
      sendPasswordReset: () => Promise.reject(new MailDeliveryError('Le fournisseur a refusé.')),
    });

    const journal = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await requestReset(
      apiRequest('/api/auth/request-password-reset', {
        method: 'POST',
        body: { email: 'connu2@example.com' },
      }),
    );

    // Le token est créé avant l'envoi : un renvoi ultérieur reste possible.
    expect(tables.passwordResetToken.rows).toHaveLength(1);

    journal.mockRestore();
    setMailerForTests(null);
  });
});
