import type { Subscription } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  GOOGLE_PLAY_NOTIFICATION_TYPES,
  appStoreEvent,
  googlePlayEvent,
  isExpiringEvent,
  isRenewalFlagEvent,
  statusForEvent,
} from '@/lib/billing/transitions';
import {
  effectivePlan,
  entitlementsFor,
  getEntitlements,
} from '@/server/entitlements/entitlements';

/**
 * Transitions de facturation et droits (`specs/paiement-in-app.md` §2, §5-§7).
 *
 * Modules purs : ni base, ni réseau. La règle §6 est vérifiée ici sur les
 * transitions elles-mêmes, indépendamment du transport des notifications.
 */
const NOW = new Date('2026-08-15T12:00:00.000Z');

function subscription(overrides: Partial<Subscription> = {}): Subscription {
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
    currentPeriodEnd: new Date('2026-09-15T12:00:00.000Z'),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('traduction des événements Google Play (§5)', () => {
  it('couvre les six événements exigés', () => {
    const { SUBSCRIPTION_PURCHASED, SUBSCRIPTION_RENEWED, SUBSCRIPTION_CANCELED } =
      GOOGLE_PLAY_NOTIFICATION_TYPES;
    const { SUBSCRIPTION_EXPIRED, SUBSCRIPTION_ON_HOLD, SUBSCRIPTION_IN_GRACE_PERIOD } =
      GOOGLE_PLAY_NOTIFICATION_TYPES;

    expect(googlePlayEvent(SUBSCRIPTION_PURCHASED)).toBe('PURCHASED');
    expect(googlePlayEvent(SUBSCRIPTION_RENEWED)).toBe('RENEWED');
    expect(googlePlayEvent(SUBSCRIPTION_CANCELED)).toBe('CANCELED');
    expect(googlePlayEvent(SUBSCRIPTION_EXPIRED)).toBe('EXPIRED');
    expect(googlePlayEvent(SUBSCRIPTION_ON_HOLD)).toBe('ON_HOLD');
    expect(googlePlayEvent(SUBSCRIPTION_IN_GRACE_PERIOD)).toBe('GRACE_PERIOD');
  });

  it('traite une révocation comme une fin d’accès immédiate', () => {
    expect(googlePlayEvent(GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_REVOKED)).toBe('EXPIRED');
  });

  it('ignore les événements sans effet sur l’accès', () => {
    expect(googlePlayEvent(GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_DEFERRED)).toBeNull();
    expect(
      googlePlayEvent(GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_PRICE_CHANGE_CONFIRMED),
    ).toBeNull();
    expect(googlePlayEvent(999)).toBeNull();
  });
});

describe('traduction des événements Apple (§5)', () => {
  it('couvre les cinq événements exigés', () => {
    expect(appStoreEvent('SUBSCRIBED', null)).toBe('PURCHASED');
    expect(appStoreEvent('DID_RENEW', null)).toBe('RENEWED');
    expect(appStoreEvent('DID_CHANGE_RENEWAL_STATUS', 'AUTO_RENEW_DISABLED')).toBe('CANCELED');
    expect(appStoreEvent('EXPIRED', null)).toBe('EXPIRED');
    expect(appStoreEvent('GRACE_PERIOD_EXPIRED', null)).toBe('EXPIRED');
  });

  it('distingue la résiliation de sa reprise via le sous-type', () => {
    expect(appStoreEvent('DID_CHANGE_RENEWAL_STATUS', 'AUTO_RENEW_ENABLED')).toBe(
      'RENEWAL_RESTORED',
    );
  });

  it('distingue une période de grâce d’une suspension', () => {
    expect(appStoreEvent('DID_FAIL_TO_RENEW', 'GRACE_PERIOD')).toBe('GRACE_PERIOD');
    expect(appStoreEvent('DID_FAIL_TO_RENEW', null)).toBe('ON_HOLD');
  });

  it('ignore un type inconnu', () => {
    expect(appStoreEvent('CONSUMPTION_REQUEST', null)).toBeNull();
  });
});

describe('nature des transitions (§6)', () => {
  it('classe résiliation et reprise comme de simples drapeaux de renouvellement', () => {
    expect(isRenewalFlagEvent('CANCELED')).toBe(true);
    expect(isRenewalFlagEvent('RENEWAL_RESTORED')).toBe(true);
    expect(isRenewalFlagEvent('EXPIRED')).toBe(false);
  });

  it('ne reconnaît qu’un seul événement de fin d’accès', () => {
    expect(isExpiringEvent('EXPIRED')).toBe(true);

    for (const event of ['CANCELED', 'ON_HOLD', 'GRACE_PERIOD', 'PAUSED'] as const) {
      expect(isExpiringEvent(event)).toBe(false);
    }
  });

  it('ne fait jamais découler de statut d’une résiliation', () => {
    // C'est le cœur de §6 : résilier ne touche ni au plan ni au statut.
    expect(statusForEvent('CANCELED')).toBeNull();
    expect(statusForEvent('RENEWAL_RESTORED')).toBeNull();
  });

  it('associe un statut aux autres événements', () => {
    expect(statusForEvent('PURCHASED')).toBe('ACTIVE');
    expect(statusForEvent('RENEWED')).toBe('ACTIVE');
    expect(statusForEvent('GRACE_PERIOD')).toBe('GRACE_PERIOD');
    expect(statusForEvent('ON_HOLD')).toBe('ON_HOLD');
    expect(statusForEvent('EXPIRED')).toBe('EXPIRED');
  });
});

describe('offre en vigueur (§6 et §7)', () => {
  it('renvoie Free sans abonnement', () => {
    expect(effectivePlan(null, NOW)).toBe('FREE');
  });

  it('conserve Plus après une résiliation, jusqu’à la fin de la période payée', () => {
    const canceled = subscription({
      cancelAtPeriodEnd: true,
      canceledAt: NOW,
    });

    expect(effectivePlan(canceled, NOW)).toBe('PLUS');
    expect(entitlementsFor(canceled, NOW).priceIncreaseAlerts).toBe(true);
  });

  it('repasse à Free une fois la période échue', () => {
    const canceled = subscription({ cancelAtPeriodEnd: true, canceledAt: NOW });
    const afterPeriod = new Date('2026-09-16T00:00:00.000Z');

    expect(effectivePlan(canceled, afterPeriod)).toBe('FREE');
    expect(entitlementsFor(canceled, afterPeriod).pdfImportEnabled).toBe(false);
  });

  it('suspend l’accès en cas d’incident de paiement, sans résiliation', () => {
    // `ON_HOLD` n'est pas une résiliation (§5) mais ne donne plus accès.
    const onHold = subscription({ status: 'ON_HOLD' });

    expect(effectivePlan(onHold, NOW)).toBe('FREE');
    expect(onHold.cancelAtPeriodEnd).toBe(false);
  });

  it('maintient l’accès pendant une période de grâce', () => {
    expect(effectivePlan(subscription({ status: 'GRACE_PERIOD' }), NOW)).toBe('PLUS');
  });

  it('applique la matrice fonctionnelle de §2', () => {
    const free = getEntitlements('FREE');
    const plus = getEntitlements('PLUS');

    expect(free).toEqual({
      maxCsvImportsPerMonth: 1,
      pdfImportEnabled: false,
      maxTrackedSubscriptions: 5,
      priceIncreaseAlerts: false,
      advancedComparisons: false,
      savingsGoalsLimit: 1,
      fullHistory: false,
      aiMonthlyCredits: 3,
    });

    expect(plus.maxCsvImportsPerMonth).toBeNull();
    expect(plus.pdfImportEnabled).toBe(true);
    expect(plus.maxTrackedSubscriptions).toBeNull();
    expect(plus.priceIncreaseAlerts).toBe(true);
    expect(plus.advancedComparisons).toBe(true);
    expect(plus.savingsGoalsLimit).toBeNull();
    expect(plus.fullHistory).toBe(true);
    expect(plus.aiMonthlyCredits).toBeGreaterThan(free.aiMonthlyCredits);
  });
});
