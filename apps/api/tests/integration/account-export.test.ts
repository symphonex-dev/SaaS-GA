import type { AuthenticatedSessionDto, UserDataExport } from '@subscription-manager/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { GET as exportAccount } from '@/app/api/account/export/route';
import { resetRateLimits } from '@/lib/security/rate-limit';

import { attachExpense, attachSubscription, createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/** GET /api/account/export — `specs/auth-comptes-rgpd.md` §8. */
describe('export RGPD', () => {
  let session: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();
    session = await createUserWithSession({ email: 'export@example.com' });
    attachExpense(session.user.id, 'NETFLIX.COM');
    attachSubscription(session.user.id, { plan: 'PLUS', status: 'ACTIVE' });
  });

  async function lireExport(token: string): Promise<{ response: Response; data: UserDataExport }> {
    const response = await exportAccount(apiRequest('/api/account/export', { token }));
    const data = (await response.clone().json()) as UserDataExport;

    return { response, data };
  }

  it('renvoie un fichier JSON en pièce jointe', async () => {
    const { response } = await lireExport(session.token);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="user-data.json"',
    );
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('contient la structure complète attendue par la spec', async () => {
    const { data } = await lireExport(session.token);

    expect(Object.keys(data).sort()).toEqual(
      [
        'exportedAt',
        'expenses',
        'recurringDetections',
        'savingsGoals',
        'subscription',
        'user',
      ].sort(),
    );
    expect(data.user.email).toBe('export@example.com');
    expect(data.expenses).toHaveLength(1);
    expect(data.subscription).not.toBeNull();
  });

  it("n'expose aucun secret", async () => {
    const { response } = await lireExport(session.token);
    const brut = await response.text();

    expect(brut).not.toContain('passwordHash');
    expect(brut).not.toContain('$argon2id$');
    expect(brut).not.toContain('tokenHash');
    // Identifiants de transaction des stores : hors du périmètre utile (§8).
    expect(brut).not.toContain('storeTransactionId');
    expect(brut).not.toContain(`txn_${session.user.id}`);
  });

  it("ne contient que les données de l'utilisateur authentifié", async () => {
    const voisin = await createUserWithSession({ email: 'voisin@example.com' });
    attachExpense(voisin.user.id, 'SPOTIFY');

    const { data } = await lireExport(session.token);
    const marchands = (data.expenses as { merchantRaw: string }[]).map((e) => e.merchantRaw);

    expect(marchands).toEqual(['NETFLIX.COM']);
    expect(marchands).not.toContain('SPOTIFY');
  });

  it("refuse l'export sans session", async () => {
    const response = await exportAccount(apiRequest('/api/account/export'));

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });

  it("refuse l'export avec un token révoqué", async () => {
    (tables.authSession.rows[0] as { revokedAt: Date | null }).revokedAt = new Date();

    const response = await exportAccount(
      apiRequest('/api/account/export', { token: session.token }),
    );

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });
});
