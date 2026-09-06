import {
  ERROR_CODES,
  type AuthenticatedUser,
  type BillingEvent,
  type StorePlatform,
  type SubscriptionDto,
  type VerifyPurchaseInput,
} from '@subscription-manager/shared';
import type { Subscription } from '@prisma/client';

import { AppError } from '@/lib/api/errors';
import { resolveProduct } from '@/lib/billing/plans';
import {
  requireStoreClient,
  type PurchaseReference,
  type StoreSubscriptionState,
} from '@/lib/billing/store-client';
import { isRenewalFlagEvent, statusForEvent } from '@/lib/billing/transitions';
import { effectivePlan } from '@/server/entitlements/entitlements';
import { storeNotificationRepository } from '@/server/repositories/store-notification.repository';
import {
  subscriptionRepository,
  type SubscriptionWriteData,
} from '@/server/repositories/subscription.repository';

/**
 * Facturation in-app (`specs/paiement-in-app.md`).
 *
 * Principe directeur (§1) : le client ne décide jamais du plan, du statut ni de
 * la date de fin de période. Toute écriture d'ici découle soit d'une
 * vérification auprès de l'API du store, soit d'une notification serveur
 * elle-même authentifiée. Il n'existe aucune route par laquelle un utilisateur
 * pourrait fixer son propre plan.
 *
 * Aucune donnée de carte bancaire n'est jamais reçue, stockée ni traitée : le
 * paiement est intégralement pris en charge par le compte Google/Apple.
 */

/** Projection renvoyée au mobile : les identifiants de store restent serveur. */
export function toSubscriptionDto(subscription: Subscription): SubscriptionDto {
  return {
    id: subscription.id,
    store: subscription.store,
    plan: subscription.plan,
    status: subscription.status,
    billingCycle: subscription.billingCycle,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    canceledAt: subscription.canceledAt?.toISOString() ?? null,
  };
}

/** État d'un compte sans aucun abonnement : l'offre Free, jamais rien d'autre. */
function freeSubscriptionDto(): SubscriptionDto {
  return {
    id: '',
    store: null,
    plan: 'FREE',
    status: 'EXPIRED',
    billingCycle: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
  };
}

/** Statut déduit de ce que le store affirme, à la vérification d'un achat. */
function statusFromStore(state: StoreSubscriptionState): Subscription['status'] {
  if (state.onHold) {
    return 'ON_HOLD';
  }

  return state.inGracePeriod ? 'GRACE_PERIOD' : 'ACTIVE';
}

/**
 * Applique une **résiliation** (`specs/paiement-in-app.md` §6).
 *
 * Décision produit définitive : l'utilisateur conserve l'accès payant jusqu'à
 * `currentPeriodEnd`. Cette fonction ne touche donc **que** au drapeau de
 * renouvellement — ni `plan`, ni `status`, ni `currentPeriodEnd`. Elle est
 * volontairement isolée d'`applyExpiration` pour rester testable seule.
 */
export async function applyCancellation(userId: string, now: Date): Promise<Subscription> {
  return subscriptionRepository.save(userId, { cancelAtPeriodEnd: true, canceledAt: now });
}

/**
 * Applique une **expiration effective** (§6).
 *
 * Seul chemin par lequel un compte repasse à `FREE`. Déclenché par
 * `SUBSCRIPTION_EXPIRED` (Google) ou `EXPIRED` (Apple), ou par le job de
 * secours quand la notification n'arrive pas.
 */
export async function applyExpiration(userId: string): Promise<Subscription> {
  return subscriptionRepository.save(userId, { plan: 'FREE', status: 'EXPIRED' });
}

/** Réactivation du renouvellement automatique avant la fin de la période. */
async function applyRenewalRestored(userId: string): Promise<Subscription> {
  return subscriptionRepository.save(userId, { cancelAtPeriodEnd: false, canceledAt: null });
}

/**
 * Traduit un état de store en écriture d'abonnement.
 *
 * Le produit est résolu depuis la configuration serveur : un identifiant
 * inconnu n'accorde aucun plan (§3).
 */
function writeDataFromState(
  state: StoreSubscriptionState,
  store: StorePlatform,
): SubscriptionWriteData {
  const product = resolveProduct(store, state.productId);

  if (product === null) {
    throw new AppError(
      ERROR_CODES.BILLING_PRODUCT_UNKNOWN,
      'Produit inconnu de la configuration.',
      'productId',
    );
  }

  return {
    store,
    storeProductId: state.productId,
    storeTransactionId: state.transactionId,
    storeOriginalTransactionId: state.originalTransactionId,
    plan: product.plan,
    status: statusFromStore(state),
    billingCycle: product.billingCycle,
    currentPeriodEnd: state.expiresAt,
    // Le store fait foi sur le renouvellement automatique : s'il est désactivé,
    // l'abonnement est déjà résilié, et l'accès court jusqu'à `expiresAt` (§6).
    cancelAtPeriodEnd: !state.autoRenewing,
  };
}

export interface NotificationOutcome {
  /** `false` quand l'événement avait déjà été traité (§5, idempotence). */
  processed: boolean;
  /** `null` pour un événement sans effet sur l'accès, ou non rattachable. */
  event: BillingEvent | null;
  reason?: 'DUPLICATE' | 'UNMAPPED_EVENT' | 'UNKNOWN_SUBSCRIPTION';
}

export const billingService = {
  /**
   * `POST /api/billing/purchase/verify` (§4).
   *
   * Le client transmet une preuve d'achat ; le serveur la revérifie auprès du
   * store et n'écrit que si la vérification réussit. Rien de ce que le client
   * affirme sur le plan ou l'échéance n'est repris.
   */
  async verifyPurchase(
    user: AuthenticatedUser,
    input: VerifyPurchaseInput,
    now: Date = new Date(),
  ): Promise<SubscriptionDto> {
    // Première barrière : le produit doit exister dans la configuration
    // serveur, avant même de parler au store.
    if (resolveProduct(input.store, input.productId) === null) {
      throw new AppError(
        ERROR_CODES.BILLING_PRODUCT_UNKNOWN,
        'Produit inconnu de la configuration.',
        'productId',
      );
    }

    const client = requireStoreClient(input.store);
    const reference: PurchaseReference = {
      ...(input.purchaseToken === undefined ? {} : { purchaseToken: input.purchaseToken }),
      ...(input.transactionId === undefined ? {} : { transactionId: input.transactionId }),
    };

    const state = await client.fetchSubscription(reference);

    if (state === null) {
      throw new AppError(
        ERROR_CODES.BILLING_VERIFICATION_FAILED,
        "Le store n'a pas confirmé cet achat.",
      );
    }

    // Le produit annoncé par le client doit être celui que le store confirme :
    // sinon un jeton d'abonnement mensuel achèterait l'offre annuelle.
    if (state.productId !== input.productId) {
      throw new AppError(
        ERROR_CODES.BILLING_VERIFICATION_FAILED,
        "L'achat ne correspond pas au produit annoncé.",
        'productId',
      );
    }

    if (!state.active) {
      throw new AppError(
        ERROR_CODES.BILLING_VERIFICATION_FAILED,
        "Cet achat n'est pas actif chez le store.",
      );
    }

    if (state.expiresAt.getTime() <= now.getTime()) {
      throw new AppError(ERROR_CODES.BILLING_VERIFICATION_FAILED, 'Cet achat est déjà expiré.');
    }

    // Un même achat ne peut pas alimenter deux comptes : le jeton partagé est
    // le contournement le plus évident du paywall.
    const owner = await subscriptionRepository.findByOriginalTransactionId(
      input.store,
      state.originalTransactionId,
    );

    if (owner !== null && owner.userId !== user.id) {
      throw new AppError(
        ERROR_CODES.BILLING_PURCHASE_ALREADY_LINKED,
        'Cet achat est déjà rattaché à un autre compte.',
      );
    }

    const saved = await subscriptionRepository.save(
      user.id,
      writeDataFromState(state, input.store),
    );

    return toSubscriptionDto(saved);
  },

  /** État d'abonnement de l'utilisateur, tel qu'il peut être affiché. */
  async getSubscription(
    user: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<{ subscription: SubscriptionDto; plan: 'FREE' | 'PLUS' }> {
    const subscription = await subscriptionRepository.findByUserId(user.id);

    return {
      subscription: subscription === null ? freeSubscriptionDto() : toSubscriptionDto(subscription),
      // Le plan renvoyé est celui **réellement en vigueur** : le mobile ne
      // recalcule jamais les droits à partir des dates (§7).
      plan: effectivePlan(subscription, now),
    };
  },

  /**
   * Traite une notification serveur déjà authentifiée (§5).
   *
   * Enchaînement : réservation idempotente de l'identifiant d'événement →
   * rattachement à un abonnement → relecture de l'état auprès du store →
   * application de la transition.
   *
   * La notification ne dicte jamais l'état à elle seule : sauf pour les
   * événements de résiliation et d'expiration, qui sont des transitions pures
   * (§6), l'état est relu auprès du store avant écriture.
   */
  async handleNotification(params: {
    eventId: string;
    store: StorePlatform;
    type: string;
    event: BillingEvent | null;
    reference: PurchaseReference;
    now: Date;
  }): Promise<NotificationOutcome> {
    const claimed = await storeNotificationRepository.claim(
      params.eventId,
      params.store,
      params.type,
    );

    if (!claimed) {
      // Notification rejouée par le store : acquittée sans être retraitée.
      return { processed: false, event: params.event, reason: 'DUPLICATE' };
    }

    if (params.event === null) {
      await storeNotificationRepository.markProcessed(params.eventId, params.now);

      return { processed: false, event: null, reason: 'UNMAPPED_EVENT' };
    }

    const subscription = await subscriptionRepository.findByStoreReference(params.store, {
      ...(params.reference.transactionId === undefined
        ? {}
        : { transactionId: params.reference.transactionId }),
      ...(params.reference.originalTransactionId === undefined
        ? {}
        : { originalTransactionId: params.reference.originalTransactionId }),
    });

    if (subscription === null) {
      // Achat jamais vérifié par nos soins : impossible de l'attribuer à un
      // compte. L'événement est acquitté pour ne pas boucler côté store.
      await storeNotificationRepository.markProcessed(params.eventId, params.now);

      return { processed: false, event: params.event, reason: 'UNKNOWN_SUBSCRIPTION' };
    }

    await applyEvent(subscription, params.event, params.store, params.reference, params.now);
    await storeNotificationRepository.markProcessed(params.eventId, params.now);

    return { processed: true, event: params.event };
  },

  /**
   * Job de secours (§6) : repasse à `FREE` les abonnements dont la période est
   * échue sans qu'aucune notification d'expiration ne soit arrivée.
   *
   * Idempotent : un abonnement déjà `FREE` n'est plus sélectionné.
   */
  async expireOverdueSubscriptions(now: Date = new Date()): Promise<{ expired: number }> {
    const overdue = await subscriptionRepository.listOverduePaid(now);

    for (const subscription of overdue) {
      await applyExpiration(subscription.userId);
    }

    return { expired: overdue.length };
  },
};

/**
 * Applique une transition à un abonnement existant.
 *
 * Trois familles, volontairement séparées :
 *  - résiliation / reprise du renouvellement : **aucun** effet sur l'accès ;
 *  - expiration : seul chemin vers `FREE` ;
 *  - tout le reste : l'état est relu auprès du store, jamais déduit de la
 *    notification.
 */
async function applyEvent(
  subscription: Subscription,
  event: BillingEvent,
  store: StorePlatform,
  reference: PurchaseReference,
  now: Date,
): Promise<void> {
  if (isRenewalFlagEvent(event)) {
    if (event === 'CANCELED') {
      await applyCancellation(subscription.userId, now);
    } else {
      await applyRenewalRestored(subscription.userId);
    }

    return;
  }

  if (event === 'EXPIRED') {
    await applyExpiration(subscription.userId);

    return;
  }

  const client = requireStoreClient(store);
  const state = await client.fetchSubscription(reference);

  if (state === null) {
    // Le store ne confirme plus l'achat : on n'invente pas d'état, on applique
    // seulement le statut porté par l'événement.
    const status = statusForEvent(event);

    if (status !== null) {
      await subscriptionRepository.save(subscription.userId, { status });
    }

    return;
  }

  await subscriptionRepository.save(subscription.userId, writeDataFromState(state, store));
}
