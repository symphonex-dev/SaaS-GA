import type { AuthenticatedSessionDto, UserDto } from '@subscription-manager/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { GET as accountRoute } from '@/app/api/account/me/route';
import { GET as sessionRoute } from '@/app/api/auth/session/route';
import { resetRateLimits } from '@/lib/security/rate-limit';
import { applyCancellation, applyExpiration } from '@/server/services/billing.service';
import { subscriptionRepository } from '@/server/repositories/subscription.repository';

import { createUserWithSession } from '../helpers/factories';
import { apiRequest, expectSuccess } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/**
 * `User.tier` dérive strictement de l'abonnement en vigueur
 * (`specs/schema-donnees.md` §3, `specs/paiement-in-app.md` §7).
 *
 * La colonne `users.tier` reste une projection synchronisée à l'écriture —
 * utile aux index et à l'export — mais elle ne fait **jamais** autorité à la
 * lecture : c'est `effectivePlan()` qui décide, ce qui la rend incapable
 * d'accorder un accès périmé.
 */
const PERIOD_END = new Date('2026-09-15T12:00:00.000Z');

async function subscribeToPlus(userId: string, currentPeriodEnd: Date): Promise<void> {
  await subscriptionRepository.save(userId, {
    store: 'GOOGLE_PLAY',
    storeProductId: 'plus_monthly',
    storeTransactionId: `txn_${userId}`,
    storeOriginalTransactionId: `orig_${userId}`,
    plan: 'PLUS',
    status: 'ACTIVE',
    billingCycle: 'MONTHLY',
    currentPeriodEnd,
    cancelAtPeriodEnd: false,
  });
}

function storedTier(userId: string): unknown {
  return tables.user.rows.find((row) => row['id'] === userId)?.['tier'];
}

describe('offre de l’utilisateur (tier)', () => {
  let session: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();

    session = await createUserWithSession({ email: 'offre@example.com' });
  });

  async function readSessionTier(): Promise<string> {
    const data = await expectSuccess<{ user: { tier: string } }>(
      await sessionRoute(apiRequest('/api/auth/session', { token: session.token })),
    );

    return data.user.tier;
  }

  it('vaut FREE sans abonnement', async () => {
    expect(await readSessionTier()).toBe('FREE');
    expect(session.user.tier).toBe('FREE');
  });

  it('passe à PLUS après un achat vérifié, et synchronise la colonne', async () => {
    await subscribeToPlus(session.user.id, new Date('2099-01-01T00:00:00.000Z'));

    expect(await readSessionTier()).toBe('PLUS');
    // La projection en base suit l'abonnement dans la même transaction.
    expect(storedTier(session.user.id)).toBe('PLUS');
  });

  it('reste PLUS après une résiliation, tant que la période court', async () => {
    await subscribeToPlus(session.user.id, new Date('2099-01-01T00:00:00.000Z'));
    await applyCancellation(session.user.id, new Date());

    // Règle §6 : résilier ne retire pas l'accès déjà payé.
    expect(await readSessionTier()).toBe('PLUS');
  });

  it('repasse à FREE à l’expiration effective', async () => {
    await subscribeToPlus(session.user.id, new Date('2099-01-01T00:00:00.000Z'));
    await applyExpiration(session.user.id);

    expect(await readSessionTier()).toBe('FREE');
    expect(storedTier(session.user.id)).toBe('FREE');
  });

  it('n’accorde jamais PLUS sur une colonne restée en retard', async () => {
    await subscribeToPlus(session.user.id, PERIOD_END);

    // Période échue sans notification d'expiration : la colonne dit encore
    // « PLUS », la lecture doit dire « FREE ».
    await subscriptionRepository.save(session.user.id, {
      currentPeriodEnd: new Date('2020-01-01T00:00:00.000Z'),
    });

    expect(storedTier(session.user.id)).toBe('PLUS');
    expect(await readSessionTier()).toBe('FREE');
  });

  it('n’accorde jamais PLUS pendant une suspension pour impayé', async () => {
    await subscribeToPlus(session.user.id, new Date('2099-01-01T00:00:00.000Z'));
    await subscriptionRepository.save(session.user.id, { status: 'ON_HOLD' });

    expect(await readSessionTier()).toBe('FREE');
  });

  it('expose la même offre sur le profil que sur la session', async () => {
    await subscribeToPlus(session.user.id, new Date('2099-01-01T00:00:00.000Z'));

    const { user } = await expectSuccess<{ user: UserDto }>(
      await accountRoute(apiRequest('/api/account/me', { token: session.token })),
    );

    expect(user.tier).toBe(await readSessionTier());
  });
});
