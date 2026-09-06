import { getServerEnv } from '@/lib/env/server';

import { decodeJws } from './jws';
import { epochSeconds, signEs256 } from './jwt';
import type { PurchaseReference, StoreClient, StoreSubscriptionState } from './store-client';

/**
 * Client App Store Server API (`specs/paiement-in-app.md` §4, étape 4).
 *
 * Les transactions renvoyées par Apple sont elles-mêmes des JWS signés par
 * Apple ; elles arrivent ici par une connexion TLS authentifiée à l'API, et
 * leur contenu est lu tel quel. La clé privée ES256 ne vit que côté
 * `apps/api` et n'est jamais journalisée.
 */
const PRODUCTION_BASE = 'https://api.storekit.itunes.apple.com/inApps/v1';
const SANDBOX_BASE = 'https://api.storekit-sandbox.itunes.apple.com/inApps/v1';
const AUDIENCE = 'appstoreconnect-v1';
const TOKEN_TTL_SECONDS = 600;
const REQUEST_TIMEOUT_MS = 10_000;

interface AppStoreConfig {
  bundleId: string;
  issuerId: string;
  keyId: string;
  privateKey: string;
  baseUrl: string;
}

function readConfig(): AppStoreConfig | null {
  const env = getServerEnv();

  if (
    env.APP_STORE_BUNDLE_ID.length === 0 ||
    env.APP_STORE_ISSUER_ID.length === 0 ||
    env.APP_STORE_KEY_ID.length === 0 ||
    env.APP_STORE_PRIVATE_KEY.length === 0
  ) {
    return null;
  }

  return {
    bundleId: env.APP_STORE_BUNDLE_ID,
    issuerId: env.APP_STORE_ISSUER_ID,
    keyId: env.APP_STORE_KEY_ID,
    privateKey: env.APP_STORE_PRIVATE_KEY,
    baseUrl: env.APP_STORE_SANDBOX ? SANDBOX_BASE : PRODUCTION_BASE,
  };
}

function bearerToken(config: AppStoreConfig, now: Date): string {
  const issuedAt = epochSeconds(now);

  return signEs256(
    { alg: 'ES256', kid: config.keyId, typ: 'JWT' },
    {
      iss: config.issuerId,
      iat: issuedAt,
      exp: issuedAt + TOKEN_TTL_SECONDS,
      aud: AUDIENCE,
      bid: config.bundleId,
    },
    config.privateKey,
  );
}

/** Forme minimale exploitée de la réponse `subscriptions/{id}`. */
interface StatusResponse {
  data?: Array<{
    lastTransactions?: Array<{
      status?: unknown;
      originalTransactionId?: unknown;
      signedTransactionInfo?: unknown;
      signedRenewalInfo?: unknown;
    }>;
  }>;
}

/**
 * Statuts d'abonnement Apple. `1` actif, `2` expiré, `3` en nouvelle tentative
 * de facturation, `4` en période de grâce, `5` révoqué.
 */
const APPLE_STATUS = { ACTIVE: 1, EXPIRED: 2, BILLING_RETRY: 3, GRACE_PERIOD: 4 } as const;

function readState(payload: StatusResponse, bundleId: string): StoreSubscriptionState | null {
  const transaction = payload.data?.[0]?.lastTransactions?.[0];

  if (transaction === undefined || typeof transaction.signedTransactionInfo !== 'string') {
    return null;
  }

  const info = decodeJws(transaction.signedTransactionInfo)?.payload;
  const renewal =
    typeof transaction.signedRenewalInfo === 'string'
      ? decodeJws(transaction.signedRenewalInfo)?.payload
      : undefined;

  if (info === undefined) {
    return null;
  }

  // L'identifiant de bundle est revérifié : une transaction d'une autre
  // application ne doit jamais accorder de plan ici.
  if (typeof info['bundleId'] === 'string' && info['bundleId'] !== bundleId) {
    return null;
  }

  const productId = info['productId'];
  const expiresDate = info['expiresDate'];
  const transactionId = info['transactionId'];
  const originalTransactionId = info['originalTransactionId'];

  if (
    typeof productId !== 'string' ||
    typeof expiresDate !== 'number' ||
    typeof transactionId !== 'string' ||
    typeof originalTransactionId !== 'string'
  ) {
    return null;
  }

  const status = transaction.status;

  return {
    store: 'APP_STORE',
    productId,
    transactionId,
    originalTransactionId,
    // Apple exprime les dates en millisecondes depuis l'epoch.
    expiresAt: new Date(expiresDate),
    autoRenewing: renewal?.['autoRenewStatus'] === 1,
    active: status === APPLE_STATUS.ACTIVE || status === APPLE_STATUS.GRACE_PERIOD,
    onHold: status === APPLE_STATUS.BILLING_RETRY,
    inGracePeriod: status === APPLE_STATUS.GRACE_PERIOD,
  };
}

/** `null` si le store n'est pas configuré : aucun achat n'est alors vérifiable. */
export function createAppStoreClient(): StoreClient | null {
  const config = readConfig();

  if (config === null) {
    return null;
  }

  return {
    store: 'APP_STORE',

    async fetchSubscription(reference: PurchaseReference): Promise<StoreSubscriptionState | null> {
      const identifier = reference.originalTransactionId ?? reference.transactionId;

      if (identifier === undefined) {
        return null;
      }

      const response = await fetch(
        `${config.baseUrl}/subscriptions/${encodeURIComponent(identifier)}`,
        {
          headers: { authorization: `Bearer ${bearerToken(config, new Date())}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        // Le corps d'erreur n'est pas lu : il renvoie l'écho de l'identifiant.
        return null;
      }

      return readState((await response.json()) as StatusResponse, config.bundleId);
    },
  };
}
