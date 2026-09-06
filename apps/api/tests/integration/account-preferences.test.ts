import type { AuthenticatedSessionDto, UserDto } from '@subscription-manager/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { GET as me } from '@/app/api/account/me/route';
import { PATCH as updatePreferences } from '@/app/api/account/preferences/route';
import { resetRateLimits } from '@/lib/security/rate-limit';

import { createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/** GET /api/account/me et PATCH /api/account/preferences — spec §6, §7. */
describe('préférences de compte', () => {
  let session: AuthenticatedSessionDto;
  let autre: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();
    session = await createUserWithSession({ email: 'a@example.com' });
    autre = await createUserWithSession({
      email: 'b@example.com',
      language: 'es',
      country: 'ES',
      currency: 'EUR',
    });
  });

  it('renvoie le profil de la session, sans donnée sensible', async () => {
    const response = await me(apiRequest('/api/account/me', { token: session.token }));
    const data = await expectSuccess<{ user: UserDto }>(response);

    expect(data.user.email).toBe('a@example.com');
    expect(JSON.stringify(data)).not.toContain('passwordHash');
    expect(JSON.stringify(data)).not.toContain('$argon2id$');
  });

  it("met à jour les trois préférences de l'utilisateur de la session", async () => {
    const response = await updatePreferences(
      apiRequest('/api/account/preferences', {
        method: 'PATCH',
        token: session.token,
        body: { language: 'en', country: 'CA', currency: 'CAD' },
      }),
    );

    const data = await expectSuccess<{ user: UserDto }>(response);

    expect(data.user).toMatchObject({ language: 'en', country: 'CA', currency: 'CAD' });
  });

  it('ignore un userId fourni par le client et ne modifie jamais un autre compte', async () => {
    const cibleAvant = tables.user.rows.find((row) => row['email'] === 'b@example.com') as {
      id: string;
      language: string;
      country: string;
      currency: string;
    };

    await updatePreferences(
      apiRequest('/api/account/preferences', {
        method: 'PATCH',
        token: session.token,
        body: {
          language: 'en',
          country: 'CA',
          currency: 'CAD',
          // Tentative d'écrasement du compte voisin.
          userId: cibleAvant.id,
          id: cibleAvant.id,
        },
      }),
    );

    const cibleApres = tables.user.rows.find((row) => row['email'] === 'b@example.com') as {
      language: string;
      country: string;
      currency: string;
    };
    const soiMeme = tables.user.rows.find((row) => row['email'] === 'a@example.com') as {
      language: string;
    };

    expect(cibleApres.language).toBe('es');
    expect(cibleApres.country).toBe('ES');
    expect(cibleApres.currency).toBe('EUR');
    expect(soiMeme.language).toBe('en');
  });

  it('refuse une préférence hors référentiel', async () => {
    const response = await updatePreferences(
      apiRequest('/api/account/preferences', {
        method: 'PATCH',
        token: session.token,
        body: { language: 'de', country: 'FR', currency: 'EUR' },
      }),
    );

    expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
  });

  it("exige les trois champs (le client renvoie l'état complet)", async () => {
    const response = await updatePreferences(
      apiRequest('/api/account/preferences', {
        method: 'PATCH',
        token: session.token,
        body: { language: 'en' },
      }),
    );

    expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
  });

  it('refuse la mise à jour sans session', async () => {
    const response = await updatePreferences(
      apiRequest('/api/account/preferences', {
        method: 'PATCH',
        body: { language: 'en', country: 'CA', currency: 'CAD' },
      }),
    );

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });

  it("n'expose jamais le profil d'un autre utilisateur", async () => {
    const response = await me(apiRequest('/api/account/me', { token: autre.token }));
    const data = await expectSuccess<{ user: UserDto }>(response);

    expect(data.user.email).toBe('b@example.com');
  });
});
