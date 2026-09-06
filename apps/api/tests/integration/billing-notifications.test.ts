import type { AuthenticatedSessionDto, SubscriptionDto } from '@subscription-manager/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE as deleteAccountRoute } from '@/app/api/account/route';
import { POST as expireOverdueRoute } from '@/app/api/billing/expire-overdue/route';
import { POST as verifyRoute } from '@/app/api/billing/purchase/verify/route';
import { POST as appStoreRoute } from '@/app/api/webhooks/app-store/route';
import { POST as googlePlayRoute } from '@/app/api/webhooks/google-play/route';
import { setJwsVerifierForTesting } from '@/lib/billing/jws';
import { resetStoreClientsForTesting, setStoreClientForTesting } from '@/lib/billing/store-client';
import { GOOGLE_PLAY_NOTIFICATION_TYPES } from '@/lib/billing/transitions';
import { resetServerEnvCache } from '@/lib/env/server';
import { resetRateLimits } from '@/lib/security/rate-limit';
import { effectivePlan } from '@/server/entitlements/entitlements';
import { subscriptionRepository } from '@/server/repositories/subscription.repository';

import { appleNotificationPayload, fakeState, fakeStoreClient } from '../helpers/billing';
import { createUserWithSession } from '../helpers/factories';
import { googlePubSubBody, unsignedJws } from '../helpers/billing';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/**
 * Notifications serveur des stores et cycle de vie de l'abonnement
 * (`specs/paiement-in-app.md` §5, §6 et §10).
 *
 * La règle prioritaire de §6 est vérifiée de bout en bout : achat →
 * résiliation → accès **conservé** → expiration → retour à `FREE`.
 */
const PLUS_MONTHLY = 'plus_monthly';
const BUNDLE_ID = 'com.example.subscriptionmanager';
const PUBSUB_TOKEN = 'jeton-pubsub-de-test';
const PURCHASE_TOKEN = 'tok_android';
const ORIGINAL_TRANSACTION_ID = 'orig_ios';
const PERIOD_END = new Date('2026-09-15T12:00:00.000Z');
const DURING_PERIOD = new Date('2026-08-20T00:00:00.000Z');
const AFTER_PERIOD = new Date('2026-09-16T00:00:00.000Z');

describe('notifications serveur des stores', () => {
  let session: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();
    resetStoreClientsForTesting();
    setJwsVerifierForTesting(null);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    process.env['GOOGLE_PLAY_PLUS_MONTHLY_PRODUCT_ID'] = PLUS_MONTHLY;
    process.env['APP_STORE_PLUS_MONTHLY_PRODUCT_ID'] = PLUS_MONTHLY;
    process.env['GOOGLE_PLAY_PUBSUB_VERIFICATION_TOKEN'] = PUBSUB_TOKEN;
    process.env['APP_STORE_BUNDLE_ID'] = BUNDLE_ID;
    process.env['APP_STORE_ROOT_CA'] = 'Y2VydGlmaWNhdC1yYWNpbmUtZmFjdGljZQ==';
    process.env['BILLING_CRON_SECRET'] = 'secret-exploitation';
    resetServerEnvCache();

    session = await createUserWithSession({ email: 'abonne@example.com' });
  });

  afterEach(() => {
    resetStoreClientsForTesting();
    setJwsVerifierForTesting(null);

    for (const key of [
      'GOOGLE_PLAY_PLUS_MONTHLY_PRODUCT_ID',
      'APP_STORE_PLUS_MONTHLY_PRODUCT_ID',
      'GOOGLE_PLAY_PUBSUB_VERIFICATION_TOKEN',
      'APP_STORE_BUNDLE_ID',
      'APP_STORE_ROOT_CA',
      'BILLING_CRON_SECRET',
    ]) {
      delete process.env[key];
    }

    resetServerEnvCache();
  });

  /** Achat Plus mensuel vérifié, point de départ de tous les scénarios. */
  async function purchasePlus(): Promise<void> {
    setStoreClientForTesting(
      'GOOGLE_PLAY',
      fakeStoreClient(
        'GOOGLE_PLAY',
        fakeState('GOOGLE_PLAY', {
          productId: PLUS_MONTHLY,
          expiresAt: PERIOD_END,
          transactionId: PURCHASE_TOKEN,
          originalTransactionId: PURCHASE_TOKEN,
        }),
      ),
    );

    await expectSuccess<{ subscription: SubscriptionDto }>(
      await verifyRoute(
        apiRequest('/api/billing/purchase/verify', {
          method: 'POST',
          token: session.token,
          body: { store: 'GOOGLE_PLAY', productId: PLUS_MONTHLY, purchaseToken: PURCHASE_TOKEN },
        }),
      ),
    );
  }

  function googleNotification(
    notificationType: number,
    messageId: string,
    token = PUBSUB_TOKEN,
  ): Promise<Response> {
    return googlePlayRoute(
      apiRequest(`/api/webhooks/google-play?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        body: googlePubSubBody({ messageId, notificationType, purchaseToken: PURCHASE_TOKEN }),
      }),
    );
  }

  function appleNotification(params: {
    notificationType: string;
    subtype?: string | null;
    notificationUuid: string;
    originalTransactionId?: string;
  }): Promise<Response> {
    const payload = appleNotificationPayload({
      notificationUuid: params.notificationUuid,
      notificationType: params.notificationType,
      subtype: params.subtype ?? null,
      bundleId: BUNDLE_ID,
      transactionId: 'txn_ios',
      originalTransactionId: params.originalTransactionId ?? ORIGINAL_TRANSACTION_ID,
    });

    // La chaîne X.509 d'Apple ne peut pas être fabriquée depuis Node : le
    // vérificateur est remplacé, tout le reste du traitement reste réel.
    setJwsVerifierForTesting(() => ({ valid: true, payload }));

    return appStoreRoute(
      apiRequest('/api/webhooks/app-store', {
        method: 'POST',
        body: { signedPayload: unsignedJws(payload) },
      }),
    );
  }

  async function currentSubscription(): Promise<NonNullable<
    Awaited<ReturnType<typeof subscriptionRepository.findByUserId>>
  > | null> {
    return subscriptionRepository.findByUserId(session.user.id);
  }

  describe('authenticité (§5, point 1)', () => {
    it('refuse une notification Google sans le jeton Pub/Sub attendu', async () => {
      const response = await googleNotification(
        GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED,
        'msg_1',
        'mauvais-jeton',
      );

      expect(await expectErrorCode(response)).toBe('WEBHOOK_SIGNATURE_INVALID');
      expect(response.status).toBe(401);
    });

    it('refuse toute notification Google quand aucun jeton n’est configuré', async () => {
      delete process.env['GOOGLE_PLAY_PUBSUB_VERIFICATION_TOKEN'];
      resetServerEnvCache();

      const response = await googleNotification(
        GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED,
        'msg_2',
        '',
      );

      expect(await expectErrorCode(response)).toBe('WEBHOOK_SIGNATURE_INVALID');
    });

    it('refuse une charge Apple dont la signature ne se vérifie pas', async () => {
      // Vérificateur réel : une charge fabriquée ne peut pas passer.
      const response = await appStoreRoute(
        apiRequest('/api/webhooks/app-store', {
          method: 'POST',
          body: { signedPayload: unsignedJws({ notificationType: 'EXPIRED' }) },
        }),
      );

      expect(await expectErrorCode(response)).toBe('WEBHOOK_SIGNATURE_INVALID');
    });

    it('refuse une charge Apple sans certificat racine configuré', async () => {
      delete process.env['APP_STORE_ROOT_CA'];
      resetServerEnvCache();

      const response = await appStoreRoute(
        apiRequest('/api/webhooks/app-store', {
          method: 'POST',
          body: { signedPayload: unsignedJws({ notificationType: 'EXPIRED' }) },
        }),
      );

      expect(await expectErrorCode(response)).toBe('WEBHOOK_SIGNATURE_INVALID');
    });
  });

  describe('idempotence (§5, point 2)', () => {
    it('ne traite qu’une seule fois une notification rejouée', async () => {
      await purchasePlus();

      const first = await googleNotification(
        GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_CANCELED,
        'msg_rejoue',
      );
      const canceledAt = (await currentSubscription())?.canceledAt;

      const second = await googleNotification(
        GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_CANCELED,
        'msg_rejoue',
      );

      expect(await expectSuccess<{ processed: boolean }>(first)).toEqual({
        received: true,
        processed: true,
      });
      expect(await expectSuccess<{ processed: boolean }>(second)).toEqual({
        received: true,
        processed: false,
      });

      // Le second passage n'a rien réécrit : la date de résiliation est figée.
      expect((await currentSubscription())?.canceledAt).toEqual(canceledAt);
      expect(tables.storeNotificationEvent.rows).toHaveLength(1);
    });

    it('acquitte un événement sans effet sur l’accès', async () => {
      await purchasePlus();

      const response = await googleNotification(
        GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_DEFERRED,
        'msg_deferred',
      );

      expect(await expectSuccess<{ processed: boolean }>(response)).toEqual({
        received: true,
        processed: false,
      });
      expect((await currentSubscription())?.plan).toBe('PLUS');
    });

    it('acquitte une notification qui ne se rattache à aucun compte', async () => {
      const response = await googleNotification(
        GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED,
        'msg_orphelin',
      );

      expect(response.status).toBe(200);
      expect(tables.subscription.rows).toHaveLength(0);
    });
  });

  describe('résiliation : accès conservé jusqu’à la fin de la période (§6)', () => {
    it('ne modifie que le drapeau de renouvellement sur SUBSCRIPTION_CANCELED', async () => {
      await purchasePlus();

      await googleNotification(GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_CANCELED, 'msg_cancel');

      const subscription = await currentSubscription();

      expect(subscription?.cancelAtPeriodEnd).toBe(true);
      expect(subscription?.canceledAt).not.toBeNull();
      // Plan, statut et échéance sont strictement inchangés.
      expect(subscription?.plan).toBe('PLUS');
      expect(subscription?.status).toBe('ACTIVE');
      expect(subscription?.currentPeriodEnd).toEqual(PERIOD_END);
    });

    it('ne modifie que le drapeau sur autoRenewStatus:false côté Apple', async () => {
      await purchasePlus();
      // L'abonnement est rattaché au jeton Android ; on rejoue le même cas
      // avec l'identifiant Apple pour vérifier la symétrie du traitement.
      await subscriptionRepository.save(session.user.id, {
        store: 'APP_STORE',
        storeOriginalTransactionId: ORIGINAL_TRANSACTION_ID,
      });

      await appleNotification({
        notificationType: 'DID_CHANGE_RENEWAL_STATUS',
        subtype: 'AUTO_RENEW_DISABLED',
        notificationUuid: 'uuid_cancel',
      });

      const subscription = await currentSubscription();

      expect(subscription?.cancelAtPeriodEnd).toBe(true);
      expect(subscription?.plan).toBe('PLUS');
      expect(subscription?.status).toBe('ACTIVE');
    });

    it('conserve l’accès payant après résiliation, puis le retire à l’expiration', async () => {
      await purchasePlus();
      await googleNotification(GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_CANCELED, 'msg_cancel');

      const canceled = await currentSubscription();

      // Pendant la période déjà payée : accès intact.
      expect(effectivePlan(canceled, DURING_PERIOD)).toBe('PLUS');

      await googleNotification(GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED, 'msg_expired');

      const expired = await currentSubscription();

      expect(expired?.plan).toBe('FREE');
      expect(expired?.status).toBe('EXPIRED');
      expect(effectivePlan(expired, DURING_PERIOD)).toBe('FREE');
    });

    it('rétablit le renouvellement automatique sans toucher au reste', async () => {
      await purchasePlus();
      await googleNotification(GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_CANCELED, 'msg_cancel');
      await subscriptionRepository.save(session.user.id, {
        store: 'APP_STORE',
        storeOriginalTransactionId: ORIGINAL_TRANSACTION_ID,
      });

      await appleNotification({
        notificationType: 'DID_CHANGE_RENEWAL_STATUS',
        subtype: 'AUTO_RENEW_ENABLED',
        notificationUuid: 'uuid_restore',
      });

      const subscription = await currentSubscription();

      expect(subscription?.cancelAtPeriodEnd).toBe(false);
      expect(subscription?.canceledAt).toBeNull();
      expect(subscription?.plan).toBe('PLUS');
    });
  });

  describe('expiration effective (§6)', () => {
    it('repasse à FREE sur SUBSCRIPTION_EXPIRED, sans résiliation préalable', async () => {
      await purchasePlus();

      await googleNotification(GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED, 'msg_expired');

      const subscription = await currentSubscription();

      expect(subscription?.plan).toBe('FREE');
      expect(subscription?.status).toBe('EXPIRED');
    });

    it('repasse à FREE sur EXPIRED côté Apple', async () => {
      await purchasePlus();
      await subscriptionRepository.save(session.user.id, {
        store: 'APP_STORE',
        storeOriginalTransactionId: ORIGINAL_TRANSACTION_ID,
      });

      await appleNotification({ notificationType: 'EXPIRED', notificationUuid: 'uuid_expired' });

      expect((await currentSubscription())?.plan).toBe('FREE');
    });

    it('suspend l’accès sur un incident de paiement, sans le confondre avec une résiliation', async () => {
      await purchasePlus();
      setStoreClientForTesting(
        'GOOGLE_PLAY',
        fakeStoreClient(
          'GOOGLE_PLAY',
          fakeState('GOOGLE_PLAY', {
            productId: PLUS_MONTHLY,
            expiresAt: PERIOD_END,
            transactionId: PURCHASE_TOKEN,
            originalTransactionId: PURCHASE_TOKEN,
            onHold: true,
            active: false,
          }),
        ),
      );

      await googleNotification(GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_ON_HOLD, 'msg_on_hold');

      const subscription = await currentSubscription();

      expect(subscription?.status).toBe('ON_HOLD');
      // Pas une résiliation : le drapeau reste à faux.
      expect(subscription?.cancelAtPeriodEnd).toBe(false);
      expect(effectivePlan(subscription, DURING_PERIOD)).toBe('FREE');
    });
  });

  describe('job de secours sur currentPeriodEnd dépassée (§6)', () => {
    it('repasse à FREE un abonnement échu sans notification d’expiration', async () => {
      await purchasePlus();

      const response = await expireOverdueRoute(
        apiRequest('/api/billing/expire-overdue', {
          method: 'POST',
          token: 'secret-exploitation',
        }),
      );

      // Avant l'échéance, rien n'est touché : la sélection porte sur la date.
      expect(await expectSuccess<{ expired: number }>(response)).toEqual({ expired: 0 });

      await subscriptionRepository.save(session.user.id, {
        currentPeriodEnd: new Date('2026-01-01T00:00:00.000Z'),
      });

      const second = await expireOverdueRoute(
        apiRequest('/api/billing/expire-overdue', {
          method: 'POST',
          token: 'secret-exploitation',
        }),
      );

      expect(await expectSuccess<{ expired: number }>(second)).toEqual({ expired: 1 });
      expect((await currentSubscription())?.plan).toBe('FREE');
    });

    it('refuse le job sans le secret d’exploitation', async () => {
      const response = await expireOverdueRoute(
        apiRequest('/api/billing/expire-overdue', { method: 'POST', token: 'mauvais-secret' }),
      );

      expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
    });

    it('n’accorde jamais l’accès payant au-delà de la période, même sans job', async () => {
      await purchasePlus();

      // Aucun job, aucune notification : la lecture applique déjà la règle.
      expect(effectivePlan(await currentSubscription(), AFTER_PERIOD)).toBe('FREE');
    });
  });

  describe('isolation entre comptes', () => {
    it('n’applique une notification qu’à l’abonnement qu’elle désigne', async () => {
      await purchasePlus();

      const voisin = await createUserWithSession({ email: 'voisin@example.com' });

      await subscriptionRepository.save(voisin.user.id, {
        store: 'GOOGLE_PLAY',
        storeProductId: PLUS_MONTHLY,
        storeTransactionId: 'tok_du_voisin',
        storeOriginalTransactionId: 'tok_du_voisin',
        plan: 'PLUS',
        status: 'ACTIVE',
        billingCycle: 'MONTHLY',
        currentPeriodEnd: PERIOD_END,
      });

      await googleNotification(GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED, 'msg_expired');

      // La notification portait le jeton du premier compte : l'autre abonnement
      // est intact.
      expect((await currentSubscription())?.plan).toBe('FREE');
      expect((await subscriptionRepository.findByUserId(voisin.user.id))?.plan).toBe('PLUS');
    });
  });

  describe('lien avec la suppression de compte (§8)', () => {
    it('bloque la suppression tant que l’abonnement est actif et non résilié', async () => {
      await purchasePlus();

      const response = await deleteAccountRoute(
        apiRequest('/api/account', {
          method: 'DELETE',
          token: session.token,
          body: { confirmation: 'DELETE_MY_ACCOUNT' },
        }),
      );

      expect(await expectErrorCode(response)).toBe('ACCOUNT_DELETION_BLOCKED_ACTIVE_SUBSCRIPTION');
    });

    it('débloque la suppression dès la résiliation, sans attendre la fin de période', async () => {
      await purchasePlus();
      await googleNotification(GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_CANCELED, 'msg_cancel');

      const subscription = await currentSubscription();

      // L'accès payant court encore, et la suppression est pourtant possible.
      expect(effectivePlan(subscription, DURING_PERIOD)).toBe('PLUS');

      await expectSuccess<{ deleted: boolean }>(
        await deleteAccountRoute(
          apiRequest('/api/account', {
            method: 'DELETE',
            token: session.token,
            body: { confirmation: 'DELETE_MY_ACCOUNT' },
          }),
        ),
      );

      expect(tables.user.rows).toHaveLength(0);
    });
  });
});
