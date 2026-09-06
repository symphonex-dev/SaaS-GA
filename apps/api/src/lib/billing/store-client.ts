import { ERROR_CODES, type StorePlatform } from '@subscription-manager/shared';

import { AppError } from '@/lib/api/errors';

import { createAppStoreClient } from './app-store';
import { createGooglePlayClient } from './google-play';

/**
 * Accès aux API des stores (`specs/paiement-in-app.md` §1 et §4).
 *
 * Règle fondatrice : **le client n'est jamais cru sur parole**. Il transmet une
 * preuve d'achat ; l'état réel (produit, échéance, renouvellement automatique)
 * est toujours relu auprès du store. Une notification serveur ne fait que
 * déclencher cette relecture — elle ne dicte jamais l'état à elle seule.
 */

/** État normalisé d'un abonnement, tel que le store le décrit. */
export interface StoreSubscriptionState {
  store: StorePlatform;
  productId: string;
  /** Identifiant de la transaction courante (jeton d'achat côté Android). */
  transactionId: string;
  /** Identifiant stable de l'abonnement, conservé à travers les renouvellements. */
  originalTransactionId: string;
  /** Fin de la période **déjà payée** : c'est la borne de l'accès (§6). */
  expiresAt: Date;
  /** `false` dès que l'utilisateur a désactivé le renouvellement automatique. */
  autoRenewing: boolean;
  /** Le store considère-t-il l'abonnement encore actif à cet instant ? */
  active: boolean;
  /** Suspension pour incident de paiement : accès suspendu, sans résiliation. */
  onHold: boolean;
  /** Période de grâce ouverte par le store après un échec de paiement. */
  inGracePeriod: boolean;
}

/** Référence d'achat transmise par le client ou lue dans une notification. */
export interface PurchaseReference {
  /** Android : jeton d'achat Google Play. */
  purchaseToken?: string;
  /** iOS : identifiant de transaction StoreKit. */
  transactionId?: string;
  /** iOS : identifiant original, seul présent dans les notifications. */
  originalTransactionId?: string;
}

export interface StoreClient {
  readonly store: StorePlatform;
  /**
   * Lit l'état courant auprès du store.
   *
   * Renvoie `null` quand le store ne connaît pas l'achat : c'est un refus, pas
   * une erreur technique — aucun plan n'est accordé.
   */
  fetchSubscription(reference: PurchaseReference): Promise<StoreSubscriptionState | null>;
}

export class StoreUnavailableError extends AppError {
  constructor(store: StorePlatform) {
    super(ERROR_CODES.BILLING_STORE_UNAVAILABLE, `Store ${store} indisponible.`);
    this.name = 'StoreUnavailableError';
  }
}

/**
 * Clients forcés, réservés aux tests.
 *
 * Aucune requête HTTP ne peut les définir : seule une importation directe du
 * module le permet. Même mécanisme que l'injection du provider IA.
 */
const overrides = new Map<StorePlatform, StoreClient | null>();

export function setStoreClientForTesting(store: StorePlatform, client: StoreClient | null): void {
  overrides.set(store, client);
}

export function resetStoreClientsForTesting(): void {
  overrides.clear();
}

/**
 * Client courant, ou `null` si le store n'est pas configuré.
 *
 * Sans configuration, aucun achat n'est vérifiable : mieux vaut refuser
 * l'achat que d'accorder un plan sans preuve.
 */
export function resolveStoreClient(store: StorePlatform): StoreClient | null {
  const override = overrides.get(store);

  if (override !== undefined) {
    return override;
  }

  return store === 'GOOGLE_PLAY' ? createGooglePlayClient() : createAppStoreClient();
}

export function requireStoreClient(store: StorePlatform): StoreClient {
  const client = resolveStoreClient(store);

  if (client === null) {
    throw new StoreUnavailableError(store);
  }

  return client;
}
