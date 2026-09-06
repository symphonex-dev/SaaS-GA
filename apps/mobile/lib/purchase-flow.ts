import type { VerifyPurchaseInput } from '@subscription-manager/shared';

import {
  loadNativePurchases,
  storeForPlatform,
  toVerifyPurchaseInput,
  type BillingUnavailableReason,
  type NativeProduct,
  type NativePurchase,
  type NativePurchasesModule,
  type NativeSubscriptionOffer,
} from './native-purchases';

/**
 * Parcours d'achat in-app (`specs/paiement-in-app.md` §4).
 *
 * ```
 * connexion au store → offres du produit → requestPurchase
 *                    → preuve reçue par événement
 *                    → POST /api/billing/purchase/verify   (vérification serveur)
 *                    → finishTransaction                   (acquittement store)
 *                    → GET  /api/billing/subscription       (plan résolu serveur)
 * ```
 *
 * Deux points structurants imposés par les stores :
 *
 * 1. **L'achat est événementiel.** `requestPurchase()` ne résout pas avec la
 *    transaction : la preuve arrive par `purchaseUpdatedListener`. Attendre la
 *    valeur de retour laisserait passer des achats.
 * 2. **L'acquittement vient après la vérification serveur.** Un achat Android
 *    non acquitté sous 3 jours est **remboursé automatiquement** par Google, et
 *    une transaction iOS non terminée est rejouée à chaque lancement.
 *    `finishPurchase()` est donc appelé par l'écran, une fois seulement que le
 *    serveur a accordé le plan.
 *
 * ⚠️ Le jeton d'achat est une donnée sensible : il n'est ni journalisé, ni
 * stocké sur l'appareil. Il ne fait que transiter vers le serveur.
 */
export type PurchaseOutcome =
  | { status: 'verified'; input: VerifyPurchaseInput; purchase: NativePurchase }
  | { status: 'unavailable'; reason: BillingUnavailableReason }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: 'NO_OFFERING' | 'NO_PROOF' | 'STORE_ERROR' | 'TIMEOUT' };

/**
 * Délai au-delà duquel on cesse d'attendre l'événement d'achat.
 *
 * L'achat n'est ni annulé ni perdu pour autant : une transaction non acquittée
 * est rejouée par le store au prochain lancement.
 */
export const PURCHASE_EVENT_TIMEOUT_MS = 180_000;

/** Codes d'annulation utilisateur : ce n'est pas une panne, rien ne s'affiche en erreur. */
function isUserCancellation(candidate: unknown): boolean {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }

  const value = candidate as { code?: unknown; userCancelled?: unknown };

  if (value.userCancelled === true) {
    return true;
  }

  return typeof value.code === 'string' && value.code.toUpperCase().includes('CANCEL');
}

/** Offres Google Play du produit visé : `offerToken` est obligatoire à l'achat. */
function offersFor(
  products: readonly NativeProduct[],
  productId: string,
): NativeSubscriptionOffer[] {
  const product = products.find((candidate) => candidate.id === productId);
  const offers = product?.subscriptionOfferDetailsAndroid ?? product?.subscriptionOffers ?? [];

  return offers.filter((offer) => offer.offerToken.length > 0);
}

interface PendingPurchase {
  resolve: (outcome: PurchaseOutcome) => void;
}

/**
 * Déclenche l'achat et renvoie la **preuve** à faire vérifier par le serveur.
 *
 * `purchases` est injectable pour les tests : le SDK natif n'existe pas dans un
 * environnement Node, et aucun test ne doit pouvoir fabriquer un achat que le
 * serveur accepterait — c'est précisément pourquoi la vérification reste
 * entièrement côté serveur.
 */
export async function purchaseProduct(
  productId: string,
  purchases: NativePurchasesModule | null = null,
  timeoutMs: number = PURCHASE_EVENT_TIMEOUT_MS,
): Promise<PurchaseOutcome> {
  const store = storeForPlatform();

  if (store === null) {
    return { status: 'unavailable', reason: 'UNSUPPORTED_PLATFORM' };
  }

  let module = purchases;

  if (module === null) {
    const capability = loadNativePurchases();

    if (!capability.available) {
      return { status: 'unavailable', reason: capability.reason };
    }

    module = capability.module;
  }

  const iap = module;
  let settled = false;
  let updated: { remove: () => void } | null = null;
  let failed: { remove: () => void } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cleanup(): void {
    updated?.remove();
    failed?.remove();

    if (timer !== null) {
      clearTimeout(timer);
    }
  }

  try {
    await iap.initConnection();

    const products = (await iap.fetchProducts({ skus: [productId], type: 'subs' })) ?? [];

    if (!products.some((product) => product.id === productId)) {
      // Le produit n'est pas proposé par le store : il n'est ni acheté, ni
      // supposé acheté. La fiche produit est à corriger dans Play Console /
      // App Store Connect (`ACTIONS_MANUELLES.md`).
      return { status: 'failed', reason: 'NO_OFFERING' };
    }

    const outcome = await new Promise<PurchaseOutcome>((resolve) => {
      const pending: PendingPurchase = {
        resolve: (result) => {
          if (settled) {
            return;
          }

          settled = true;
          resolve(result);
        },
      };

      updated = iap.purchaseUpdatedListener((purchase) => {
        const input = toVerifyPurchaseInput(store, productId, purchase);

        pending.resolve(
          input === null
            ? { status: 'failed', reason: 'NO_PROOF' }
            : { status: 'verified', input, purchase },
        );
      });

      failed = iap.purchaseErrorListener((error) => {
        pending.resolve(
          isUserCancellation(error)
            ? { status: 'cancelled' }
            : { status: 'failed', reason: 'STORE_ERROR' },
        );
      });

      timer = setTimeout(() => {
        pending.resolve({ status: 'failed', reason: 'TIMEOUT' });
      }, timeoutMs);

      const offers = offersFor(products, productId);

      void iap
        .requestPurchase({
          request: {
            apple: { sku: productId },
            google: {
              skus: [productId],
              ...(offers.length > 0 ? { subscriptionOffers: offers } : {}),
            },
          },
          type: 'subs',
        })
        .catch((error: unknown) => {
          // Rejet synchrone du store (produit invalide, store non prêt…).
          pending.resolve(
            isUserCancellation(error)
              ? { status: 'cancelled' }
              : { status: 'failed', reason: 'STORE_ERROR' },
          );
        });
    });

    return outcome;
  } catch (error) {
    return isUserCancellation(error)
      ? { status: 'cancelled' }
      : { status: 'failed', reason: 'STORE_ERROR' };
  } finally {
    cleanup();
  }
}

/**
 * Acquitte la transaction auprès du store, **après** que le serveur a accordé
 * le plan.
 *
 * Ne lève jamais : un acquittement en échec n'annule pas un achat déjà vérifié
 * côté serveur, et le store rejouera la transaction. Renvoie `false` pour que
 * l'appelant puisse le signaler sans traiter l'achat comme perdu.
 */
export async function finishPurchase(
  purchase: NativePurchase,
  purchases: NativePurchasesModule | null = null,
): Promise<boolean> {
  let module = purchases;

  if (module === null) {
    const capability = loadNativePurchases();

    if (!capability.available) {
      return false;
    }

    module = capability.module;
  }

  try {
    // `isConsumable: false` : un abonnement n'est jamais consommé — le
    // consommer permettrait de le racheter immédiatement.
    await module.finishTransaction({ purchase, isConsumable: false });

    return true;
  } catch {
    return false;
  }
}
