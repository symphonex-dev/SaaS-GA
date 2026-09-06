/**
 * Miroir exact des enums Prisma de `specs/schema-donnees.md` §2.
 *
 * Source de vérité : `apps/api/prisma/schema.prisma`. Toute modification d'un
 * enum Prisma doit être répercutée ici (et inversement) — ces tuples sont
 * utilisés par les schémas Zod partagés, donc par la validation côté API ET
 * côté formulaire mobile.
 */

export const USER_TIERS = ['FREE', 'PLUS'] as const;
export type UserTier = (typeof USER_TIERS)[number];

export const EXPENSE_FREQUENCIES = [
  'ONCE',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
  'IRREGULAR_RECURRING',
] as const;
export type ExpenseFrequency = (typeof EXPENSE_FREQUENCIES)[number];

export const EXPENSE_STATUSES = ['ACTIVE', 'CANCELLED', 'TO_REVIEW'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_CATEGORIES = [
  'ENTERTAINMENT',
  'SOFTWARE',
  'STREAMING',
  'MUSIC',
  'GAMING',
  'FITNESS',
  'NEWS',
  'CLOUD',
  'TELECOM',
  'INSURANCE',
  'FINANCE',
  'EDUCATION',
  'PRODUCTIVITY',
  'FOOD',
  'TRANSPORT',
  'SHOPPING',
  'OTHER',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const PAYMENT_METHODS = [
  'CARD',
  'BANK_TRANSFER',
  'DIRECT_DEBIT',
  'PAYPAL',
  'CASH',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const DETECTION_CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type DetectionConfidence = (typeof DETECTION_CONFIDENCES)[number];

export const DETECTION_STATUSES = ['CONFIRMED', 'MODIFIED', 'REJECTED'] as const;
export type DetectionStatus = (typeof DETECTION_STATUSES)[number];

export const GOAL_STATUSES = ['ACTIVE', 'REACHED', 'ABANDONED'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/**
 * `PRO` existe uniquement pour éviter une migration future coûteuse
 * (voir `specs/schema-donnees.md` §2). Aucun flux V1 ne doit le produire ni le
 * consommer : utiliser `COMMERCIALIZED_PLANS` pour toute logique produit.
 */
export const SUBSCRIPTION_PLANS = ['FREE', 'PLUS', 'PRO'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const SUBSCRIPTION_STATUSES = [
  'ACTIVE',
  'TRIALING',
  'GRACE_PERIOD',
  'ON_HOLD',
  'PAUSED',
  'CANCELED',
  'EXPIRED',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const STORE_PLATFORMS = ['GOOGLE_PLAY', 'APP_STORE'] as const;
export type StorePlatform = (typeof STORE_PLATFORMS)[number];

export const IMPORT_SOURCE_TYPES = ['CSV', 'PDF'] as const;
export type ImportSourceType = (typeof IMPORT_SOURCE_TYPES)[number];

export const CSV_ROW_STATUSES = ['VALID', 'INVALID', 'DUPLICATE', 'REFUND', 'SKIPPED'] as const;
export type CsvRowStatus = (typeof CSV_ROW_STATUSES)[number];

/**
 * `Expense.source` est un `String` en base (et non un enum Prisma) — voir
 * `specs/schema-donnees.md` §4. Les deux seules valeurs autorisées sont
 * ci-dessous ; `MANUAL` reste une action secondaire (CLAUDE.md §5.4).
 */
export const EXPENSE_SOURCES = ['IMPORT', 'MANUAL'] as const;
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];
