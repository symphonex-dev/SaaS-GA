import { Platform } from 'react-native';

import type { VerifyPurchaseInput } from '@subscription-manager/shared';

/**
 * Chargement isolé du SDK d'achat natif (`specs/paiement-in-app.md` §4).
 *
 * ## Choix du SDK
 *
 * `expo-iap` parle **directement** à Google Play Billing et à StoreKit 2, et
 * rend le jeton d'achat brut (`purchaseToken` Android, `transactionId` iOS).
 * C'est exactement l'architecture décrite par la spec §4 : le client obtient
 * une preuve, le serveur la vérifie auprès de l'API du store.
 *
 * Le SDK précédemment déclaré (`react-native-purchases`, RevenueCat) a été
 * retiré : c'est un **back-office de facturation complet** — abonnements,
 * entitlements, webhooks — alors que `apps/api` implémente déjà la
 * vérification directe auprès de Google Play Developer API et App Store Server
 * API (`lib/billing/google-play.ts`, `lib/billing/app-store.ts`). Le garder
 * aurait signifié deux sources de vérité pour l'abonnement, un service tiers
 * payant dans le chemin de facturation, et une clé publique de plus dans le
 * bundle. Aucune spec ne le mentionne (voir `CLAUDE.md` §10.11).
 *
 * ## Isolation
 *
 * Le module contient du code natif **absent d'Expo Go**. Il n'est donc jamais
 * importé statiquement : il est demandé à la volée dans un `try/catch`, et son
 * absence est un **état déclaré**, pas une erreur. Dans Expo Go l'écran
 * d'offres reste consultable et l'annonce ; l'achat exige un *development
 * build*.
 *
 * Il n'existe **aucun repli simulant un achat réussi** : seule une preuve
 * réellement délivrée par le store part vers `POST /api/billing/purchase/verify`,
 * et c'est le serveur qui accorde le plan (§1).
 *
 * ## Secrets
 *
 * Aucun. La facturation directe n'a pas de clé côté client : seuls les
 * identifiants de produits — publics, visibles sur la fiche du store —
 * transitent par `EXPO_PUBLIC_*`, et le serveur refuse tout produit absent de
 * sa propre configuration (§3). Le jeton d'achat, lui, est une donnée sensible :
 * il n'est jamais journalisé (voir `purchase-flow.ts`).
 */
export type BillingUnavailableReason =
  /** Module natif absent du runtime courant (Expo Go, web). */
  | 'NATIVE_MODULE_UNAVAILABLE'
  /** Aucun identifiant de produit configuré pour cette version. */
  | 'NOT_CONFIGURED'
  /** Plateforme sans boutique in-app (web). */
  | 'UNSUPPORTED_PLATFORM';

export type BillingCapability =
  | { available: true; module: NativePurchasesModule }
  | { available: false; reason: BillingUnavailableReason };

/** Abonnement à un flux d'événements, tel que renvoyé par `expo-iap`. */
export interface NativeSubscription {
  remove: () => void;
}

/** Une offre d'abonnement Google Play : le `offerToken` est requis à l'achat. */
export interface NativeSubscriptionOffer {
  sku: string;
  offerToken: string;
}

export interface NativeProduct {
  id: string;
  /** Présent uniquement pour un abonnement Android. */
  subscriptionOfferDetailsAndroid?: NativeSubscriptionOffer[] | null;
  subscriptionOffers?: NativeSubscriptionOffer[] | null;
}

/**
 * Preuve d'achat telle que le store la délivre.
 *
 * ⚠️ `purchaseToken` est une donnée **sensible** : elle ne doit être ni
 * journalisée, ni persistée sur l'appareil. Elle ne fait que transiter vers le
 * serveur, qui la vérifie auprès du store.
 */
export interface NativePurchase {
  id?: string | null;
  productId?: string | null;
  /** Jeton unifié : `purchaseToken` Android, JWS iOS. */
  purchaseToken?: string | null;
  transactionId?: string | null;
}

export interface NativePurchaseError {
  code?: string | null;
  message?: string | null;
}

/**
 * Surface **minimale** de `expo-iap` réellement utilisée.
 *
 * Volontairement réduite : elle documente ce dont le parcours dépend et rend le
 * module substituable en test sans embarquer le SDK natif.
 */
export interface NativePurchasesModule {
  initConnection: () => Promise<boolean>;
  endConnection: () => Promise<boolean>;
  fetchProducts: (request: {
    skus: string[];
    type: 'subs';
  }) => Promise<NativeProduct[] | null | undefined>;
  requestPurchase: (args: {
    request: {
      apple?: { sku: string };
      google?: { skus: string[]; subscriptionOffers?: NativeSubscriptionOffer[] };
    };
    type: 'subs';
  }) => Promise<unknown>;
  /** Appelé **après** vérification serveur : sans cela Google rembourse sous 3 jours. */
  finishTransaction: (args: {
    purchase: NativePurchase;
    isConsumable?: boolean;
  }) => Promise<unknown>;
  purchaseUpdatedListener: (listener: (purchase: NativePurchase) => void) => NativeSubscription;
  purchaseErrorListener: (listener: (error: NativePurchaseError) => void) => NativeSubscription;
}

/** Store visé par la plateforme courante, ou `null` s'il n'y en a pas. */
export function storeForPlatform(
  platform: string = Platform.OS,
): VerifyPurchaseInput['store'] | null {
  if (platform === 'android') {
    return 'GOOGLE_PLAY';
  }

  return platform === 'ios' ? 'APP_STORE' : null;
}

/**
 * Identifiants des produits Plus, tels qu'ils sont déclarés dans Play Console
 * et App Store Connect (`ACTIONS_MANUELLES.md`).
 *
 * Ce ne sont pas des secrets : un identifiant de produit est visible de tout
 * acheteur sur la fiche du store. Le serveur possède la **même** configuration
 * (`GOOGLE_PLAY_PLUS_*_PRODUCT_ID` / `APP_STORE_PLUS_*_PRODUCT_ID`) et refuse
 * tout produit qui n'y figure pas : un identifiant fabriqué côté client
 * n'accorde donc rien (`specs/paiement-in-app.md` §3).
 */
export function plusProductIds(): { monthly: string | null; yearly: string | null } {
  // Accès statique : c'est cette forme exacte que le plugin Babel d'Expo
  // remplace par la valeur au moment du bundling.
  const monthly: unknown = process.env.EXPO_PUBLIC_PLUS_MONTHLY_PRODUCT_ID;
  const yearly: unknown = process.env.EXPO_PUBLIC_PLUS_YEARLY_PRODUCT_ID;

  return {
    monthly: typeof monthly === 'string' && monthly.trim().length > 0 ? monthly.trim() : null,
    yearly: typeof yearly === 'string' && yearly.trim().length > 0 ? yearly.trim() : null,
  };
}

/**
 * Extrait la preuve d'achat à transmettre au serveur.
 *
 * Le client ne transmet **jamais** un plan, un statut ni une date de fin de
 * période : uniquement ce que le store a délivré (`specs/paiement-in-app.md`
 * §4). Une preuve absente est un échec, jamais un achat supposé.
 */
export function toVerifyPurchaseInput(
  store: VerifyPurchaseInput['store'],
  productId: string,
  purchase: NativePurchase,
): VerifyPurchaseInput | null {
  if (store === 'GOOGLE_PLAY') {
    const purchaseToken = purchase.purchaseToken ?? null;

    return purchaseToken === null || purchaseToken.length === 0
      ? null
      : { store, productId, purchaseToken };
  }

  // StoreKit 2 : `transactionId` identifie la transaction auprès de l'App Store
  // Server API. `id` est le même identifiant sur les versions récentes du SDK.
  const transactionId = purchase.transactionId ?? purchase.id ?? null;

  return transactionId === null || transactionId.length === 0
    ? null
    : { store, productId, transactionId };
}

function isNativePurchasesModule(candidate: unknown): candidate is NativePurchasesModule {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }

  const module = candidate as Record<string, unknown>;

  return (
    [
      'initConnection',
      'endConnection',
      'fetchProducts',
      'requestPurchase',
      'finishTransaction',
      'purchaseUpdatedListener',
      'purchaseErrorListener',
    ] as const
  ).every((name) => typeof module[name] === 'function');
}

let resolved: BillingCapability | null = null;

/**
 * Charge le SDK si — et seulement si — le runtime courant le possède.
 *
 * Ne lève jamais : une absence est renvoyée comme un état. C'est ce qui permet
 * à l'application de démarrer normalement dans Expo Go.
 */
export function loadNativePurchases(): BillingCapability {
  if (resolved !== null) {
    return resolved;
  }

  if (storeForPlatform() === null) {
    resolved = { available: false, reason: 'UNSUPPORTED_PLATFORM' };

    return resolved;
  }

  const products = plusProductIds();

  if (products.monthly === null && products.yearly === null) {
    resolved = { available: false, reason: 'NOT_CONFIGURED' };

    return resolved;
  }

  try {
    // `require` et non `import` : la résolution doit pouvoir échouer sans
    // interrompre le chargement du bundle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const imported: unknown = require('expo-iap');

    resolved = isNativePurchasesModule(imported)
      ? { available: true, module: imported }
      : { available: false, reason: 'NATIVE_MODULE_UNAVAILABLE' };
  } catch {
    // Expo Go : le module natif n'est pas lié. Ce n'est pas une panne, c'est
    // une capacité absente du runtime.
    resolved = { available: false, reason: 'NATIVE_MODULE_UNAVAILABLE' };
  }

  return resolved;
}

/** Réinitialise le cache de résolution. Réservé aux tests. */
export function resetNativePurchasesCache(): void {
  resolved = null;
}
