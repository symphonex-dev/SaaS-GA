import type { StorePlatform } from '@subscription-manager/shared';

import type {
  PurchaseReference,
  StoreClient,
  StoreSubscriptionState,
} from '@/lib/billing/store-client';

/**
 * Doubles des stores pour les tests (`specs/paiement-in-app.md` §4).
 *
 * Les vraies implémentations parlent à Google et Apple par HTTPS : elles ne
 * peuvent pas être exercées sans identifiants ni bac à sable. Ce double se
 * substitue au client, pas au service : tout le code de vérification, de
 * transition et d'écriture reste celui de production.
 */
export interface FakeStoreOptions {
  productId: string;
  expiresAt: Date;
  autoRenewing?: boolean;
  active?: boolean;
  onHold?: boolean;
  inGracePeriod?: boolean;
  transactionId?: string;
  originalTransactionId?: string;
}

export function fakeState(store: StorePlatform, options: FakeStoreOptions): StoreSubscriptionState {
  return {
    store,
    productId: options.productId,
    transactionId: options.transactionId ?? 'txn_1',
    originalTransactionId: options.originalTransactionId ?? 'orig_1',
    expiresAt: options.expiresAt,
    autoRenewing: options.autoRenewing ?? true,
    active: options.active ?? true,
    onHold: options.onHold ?? false,
    inGracePeriod: options.inGracePeriod ?? false,
  };
}

/** Client renvoyant un état figé, et comptant ses appels. */
export function fakeStoreClient(
  store: StorePlatform,
  state: StoreSubscriptionState | null,
): StoreClient & { calls: PurchaseReference[] } {
  const calls: PurchaseReference[] = [];

  return {
    store,
    calls,
    fetchSubscription(reference: PurchaseReference): Promise<StoreSubscriptionState | null> {
      calls.push(reference);

      return Promise.resolve(state);
    },
  };
}

function base64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * JWS non signé, utilisé uniquement là où la signature est vérifiée par
 * ailleurs (charge Apple déjà validée, transaction imbriquée).
 */
export function unsignedJws(payload: object): string {
  return `${base64Url({ alg: 'ES256' })}.${base64Url(payload)}.signature`;
}

/** Enveloppe Pub/Sub d'une notification Google Play. */
export function googlePubSubBody(params: {
  messageId: string;
  notificationType: number;
  purchaseToken: string;
  packageName?: string;
}): unknown {
  const notification = {
    version: '1.0',
    packageName: params.packageName ?? 'com.example.subscriptionmanager',
    eventTimeMillis: '1780000000000',
    subscriptionNotification: {
      version: '1.0',
      notificationType: params.notificationType,
      purchaseToken: params.purchaseToken,
      subscriptionId: 'plus_monthly',
    },
  };

  return {
    message: {
      data: Buffer.from(JSON.stringify(notification)).toString('base64'),
      messageId: params.messageId,
      publishTime: '2026-08-01T00:00:00.000Z',
    },
    subscription: 'projects/demo/subscriptions/play',
  };
}

/** Charge d'une notification App Store Server V2 (avant signature). */
export function appleNotificationPayload(params: {
  notificationUuid: string;
  notificationType: string;
  subtype?: string | null;
  bundleId: string;
  transactionId: string;
  originalTransactionId: string;
}): Record<string, unknown> {
  return {
    notificationType: params.notificationType,
    ...(params.subtype == null ? {} : { subtype: params.subtype }),
    notificationUUID: params.notificationUuid,
    data: {
      bundleId: params.bundleId,
      signedTransactionInfo: unsignedJws({
        transactionId: params.transactionId,
        originalTransactionId: params.originalTransactionId,
        bundleId: params.bundleId,
      }),
    },
  };
}
