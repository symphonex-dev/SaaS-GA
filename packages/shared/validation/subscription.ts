import { z } from 'zod';

import { STORE_PLATFORMS, SUBSCRIPTION_PLANS, SUBSCRIPTION_STATUSES } from '../constants/enums';
import { COMMERCIALIZED_PLANS } from '../constants/plans';
import { isoDateTimeSchema } from './common';
import { billingCycleSchema } from './comparison';

export const storePlatformSchema = z.enum(STORE_PLATFORMS);
export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);

/** Enum complet tel qu'il existe en base (inclut `PRO`, non commercialisé). */
export const subscriptionPlanSchema = z.enum(SUBSCRIPTION_PLANS);

/**
 * Plans autorisés dans un flux V1. Toute écriture applicative passe par ce
 * schéma : `PRO` ne doit jamais être produit ni consommé
 * (`specs/schema-donnees.md` §2 et §15).
 */
export const commercializedPlanSchema = z.enum(COMMERCIALIZED_PLANS);

/**
 * État d'une `Subscription` tel qu'il est écrit après vérification d'un achat
 * ou d'une notification serveur d'un store (schéma §9).
 *
 * Aucun champ Stripe : `store` + `storeProductId` + identifiants de transaction
 * remplacent les identifiants Stripe (CLAUDE.md §5.7).
 */
export const subscriptionStateSchema = z
  .object({
    store: storePlatformSchema.nullish(),
    storeProductId: z.string().trim().min(1).max(200).nullish(),
    storeTransactionId: z.string().trim().min(1).max(200).nullish(),
    storeOriginalTransactionId: z.string().trim().min(1).max(200).nullish(),
    plan: commercializedPlanSchema,
    status: subscriptionStatusSchema,
    billingCycle: billingCycleSchema.nullish(),
    currentPeriodEnd: isoDateTimeSchema.nullish(),
    cancelAtPeriodEnd: z.boolean().default(false),
    canceledAt: isoDateTimeSchema.nullish(),
  })
  .refine(
    (state) => state.plan === 'FREE' || state.currentPeriodEnd != null,
    'PAID_PLAN_REQUIRES_PERIOD_END',
  )
  .refine(
    (state) => !state.cancelAtPeriodEnd || state.canceledAt != null,
    'CANCELED_AT_REQUIRED_WHEN_CANCEL_AT_PERIOD_END',
  );

/**
 * Enregistrement d'idempotence d'une notification serveur de store
 * (schéma §13) : l'`id` fourni par le store est la clé, enregistrée avant
 * traitement et jamais retraitée.
 */
export const storeNotificationEventSchema = z.object({
  id: z.string().trim().min(1).max(200),
  store: storePlatformSchema,
  type: z.string().trim().min(1).max(100),
});

export type SubscriptionStateInput = z.infer<typeof subscriptionStateSchema>;
export type StoreNotificationEventInput = z.infer<typeof storeNotificationEventSchema>;

/**
 * Corps de `POST /api/billing/purchase/verify` (`specs/paiement-in-app.md` §4).
 *
 * Le client ne transmet **jamais** un plan, un statut ni une date de fin de
 * période : uniquement la preuve d'achat renvoyée par le SDK natif. Tout le
 * reste est établi par le serveur auprès de l'API du store (§1).
 */
export const verifyPurchaseSchema = z
  .object({
    store: storePlatformSchema,
    productId: z.string().trim().min(1).max(200),
    /** Android : jeton d'achat de Google Play Billing. */
    purchaseToken: z.string().trim().min(1).max(4096).optional(),
    /** iOS : identifiant de transaction StoreKit 2. */
    transactionId: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (input) => (input.store === 'GOOGLE_PLAY' ? input.purchaseToken != null : true),
    'PURCHASE_TOKEN_REQUIRED',
  )
  .refine(
    (input) => (input.store === 'APP_STORE' ? input.transactionId != null : true),
    'TRANSACTION_ID_REQUIRED',
  );

export type VerifyPurchaseInput = z.infer<typeof verifyPurchaseSchema>;
