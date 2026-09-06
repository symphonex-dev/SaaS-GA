import { getServerEnv } from '@/lib/env/server';

import { epochSeconds, signRs256 } from './jwt';
import type { PurchaseReference, StoreClient, StoreSubscriptionState } from './store-client';

/**
 * Client Google Play Developer API (`specs/paiement-in-app.md` §4, étape 4).
 *
 * Vérifie un achat auprès de Google plutôt que de croire le client. La clé du
 * compte de service ne vit que côté `apps/api` et n'est jamais journalisée.
 */
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const TOKEN_TTL_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 10_000;

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function parseServiceAccount(raw: string): ServiceAccount | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;

    return typeof parsed.client_email === 'string' && typeof parsed.private_key === 'string'
      ? { client_email: parsed.client_email, private_key: parsed.private_key }
      : null;
  } catch {
    return null;
  }
}

/** Échange l'assertion JWT du compte de service contre un jeton d'accès. */
async function accessToken(account: ServiceAccount, now: Date): Promise<string | null> {
  const issuedAt = epochSeconds(now);
  const assertion = signRs256(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: issuedAt,
      exp: issuedAt + TOKEN_TTL_SECONDS,
    },
    account.private_key,
  );

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { access_token?: unknown };

  return typeof payload.access_token === 'string' ? payload.access_token : null;
}

/**
 * Forme minimale exploitée de `purchases.subscriptionsv2`.
 * Rien d'autre n'est lu : aucune donnée de paiement ne transite ici.
 */
interface SubscriptionPurchaseV2 {
  subscriptionState?: unknown;
  latestOrderId?: unknown;
  lineItems?: Array<{
    productId?: unknown;
    expiryTime?: unknown;
    autoRenewingPlan?: { autoRenewEnabled?: unknown };
  }>;
}

function readState(
  payload: SubscriptionPurchaseV2,
  purchaseToken: string,
): StoreSubscriptionState | null {
  const lineItem = payload.lineItems?.[0];
  const productId = lineItem?.productId;
  const expiryTime = lineItem?.expiryTime;

  if (typeof productId !== 'string' || typeof expiryTime !== 'string') {
    return null;
  }

  const expiresAt = new Date(expiryTime);

  if (Number.isNaN(expiresAt.getTime())) {
    return null;
  }

  const state = typeof payload.subscriptionState === 'string' ? payload.subscriptionState : '';

  return {
    store: 'GOOGLE_PLAY',
    productId,
    // Le jeton d'achat identifie l'abonnement de bout en bout côté Android :
    // il reste stable à travers les renouvellements.
    transactionId:
      typeof payload.latestOrderId === 'string' ? payload.latestOrderId : purchaseToken,
    originalTransactionId: purchaseToken,
    expiresAt,
    autoRenewing: lineItem?.autoRenewingPlan?.autoRenewEnabled === true,
    active: state === 'SUBSCRIPTION_STATE_ACTIVE' || state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
    onHold: state === 'SUBSCRIPTION_STATE_ON_HOLD' || state === 'SUBSCRIPTION_STATE_PAUSED',
    inGracePeriod: state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  };
}

/** `null` si le store n'est pas configuré : aucun achat n'est alors vérifiable. */
export function createGooglePlayClient(): StoreClient | null {
  const env = getServerEnv();
  const account = parseServiceAccount(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);

  if (account === null || env.GOOGLE_PLAY_PACKAGE_NAME.length === 0) {
    return null;
  }

  return {
    store: 'GOOGLE_PLAY',

    async fetchSubscription(reference: PurchaseReference): Promise<StoreSubscriptionState | null> {
      const purchaseToken = reference.purchaseToken ?? reference.originalTransactionId;

      if (purchaseToken === undefined) {
        return null;
      }

      const token = await accessToken(account, new Date());

      if (token === null) {
        return null;
      }

      const response = await fetch(
        `${API_BASE}/applications/${encodeURIComponent(
          env.GOOGLE_PLAY_PACKAGE_NAME,
        )}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
        {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        // Le corps d'erreur n'est pas lu : il renvoie l'écho du jeton d'achat.
        return null;
      }

      return readState((await response.json()) as SubscriptionPurchaseV2, purchaseToken);
    },
  };
}
