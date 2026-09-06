import type { Subscription } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { canDeleteAccount } from '@/server/services/user.service';

/**
 * `specs/auth-comptes-rgpd.md` §9 et CLAUDE.md §5.9 — seul un abonnement payant
 * encore actif ET non résilié bloque la suppression.
 */
function subscription(overrides: Partial<Subscription>): Subscription {
  return {
    id: 'sub_1',
    userId: 'usr_1',
    store: 'GOOGLE_PLAY',
    storeProductId: 'plus_monthly',
    storeTransactionId: 'txn_1',
    storeOriginalTransactionId: 'orig_1',
    plan: 'PLUS',
    status: 'ACTIVE',
    billingCycle: 'MONTHLY',
    currentPeriodEnd: new Date('2026-12-31T00:00:00.000Z'),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('canDeleteAccount', () => {
  it('autorise la suppression sans abonnement', () => {
    expect(canDeleteAccount(null)).toBe(true);
  });

  it('autorise la suppression sur le plan FREE', () => {
    expect(canDeleteAccount(subscription({ plan: 'FREE', status: 'ACTIVE' }))).toBe(true);
  });

  it("autorise la suppression si l'abonnement est expiré", () => {
    expect(canDeleteAccount(subscription({ status: 'EXPIRED' }))).toBe(true);
  });

  it('autorise la suppression dès la résiliation, sans attendre currentPeriodEnd', () => {
    const resilie = subscription({
      status: 'ACTIVE',
      cancelAtPeriodEnd: true,
      canceledAt: new Date('2026-06-01T00:00:00.000Z'),
      // L'accès payant court encore : la suppression est malgré tout autorisée.
      currentPeriodEnd: new Date('2026-12-31T00:00:00.000Z'),
    });

    expect(canDeleteAccount(resilie)).toBe(true);
  });

  it('bloque la suppression avec un abonnement payant actif non résilié', () => {
    expect(canDeleteAccount(subscription({ status: 'ACTIVE', cancelAtPeriodEnd: false }))).toBe(
      false,
    );
  });

  it.each(['TRIALING', 'GRACE_PERIOD', 'ON_HOLD', 'PAUSED', 'CANCELED'] as const)(
    'bloque la suppression pour un abonnement payant non résilié au statut %s',
    (status) => {
      expect(canDeleteAccount(subscription({ status, cancelAtPeriodEnd: false }))).toBe(false);
    },
  );
});
