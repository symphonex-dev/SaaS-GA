import type { SubscriptionPlan, SubscriptionStatus, UserTier } from './enums';

/**
 * Offres réellement commercialisées en V1 (CLAUDE.md §1) : Free et Plus.
 * `PRO` existe dans l'enum Prisma `SubscriptionPlan` mais ne doit être produit
 * ni consommé par aucun flux V1 (`specs/schema-donnees.md` §2 et §15).
 */
export const COMMERCIALIZED_PLANS = ['FREE', 'PLUS'] as const;
export type CommercializedPlan = (typeof COMMERCIALIZED_PLANS)[number];

/** Valeur par défaut de `Subscription.plan` et de `User.tier`. */
export const DEFAULT_PLAN: CommercializedPlan = 'FREE';
export const DEFAULT_TIER: UserTier = 'FREE';

/**
 * Statuts de `Subscription` qui donnent accès aux fonctionnalités payantes.
 *
 * `CANCELED` en est volontairement absent : la résiliation ne modifie ni `plan`
 * ni `status`, elle positionne `cancelAtPeriodEnd = true` et l'accès payant est
 * conservé jusqu'à `currentPeriodEnd` (CLAUDE.md §5.8). C'est l'expiration
 * effective (`EXPIRED`) qui fait repasser le plan à `FREE`.
 */
export const PAID_ACCESS_STATUSES = ['ACTIVE', 'TRIALING', 'GRACE_PERIOD'] as const;
export type PaidAccessStatus = (typeof PAID_ACCESS_STATUSES)[number];

/** `User.tier` est dérivé exclusivement de `Subscription.plan` (schéma §3). */
export const TIER_BY_PLAN: Readonly<Record<CommercializedPlan, UserTier>> = {
  FREE: 'FREE',
  PLUS: 'PLUS',
};

export function isCommercializedPlan(value: SubscriptionPlan): value is CommercializedPlan {
  return (COMMERCIALIZED_PLANS as readonly string[]).includes(value);
}

export function grantsPaidAccess(status: SubscriptionStatus): status is PaidAccessStatus {
  return (PAID_ACCESS_STATUSES as readonly string[]).includes(status);
}
