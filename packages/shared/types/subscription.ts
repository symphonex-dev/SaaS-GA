import type {
  BillingCycle,
  StorePlatform,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../constants/enums';
import type { Id, IsoDateTimeString } from './common';

/**
 * Projection du modèle `Subscription` (schéma §9).
 *
 * Aucun identifiant Stripe : la facturation passe exclusivement par Google Play
 * Billing et Apple StoreKit (CLAUDE.md §5.7). Les identifiants de transaction
 * du store restent côté serveur et ne sont pas exposés au client.
 */
export interface SubscriptionDto {
  id: Id;
  store: StorePlatform | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  billingCycle: BillingCycle | null;
  currentPeriodEnd: IsoDateTimeString | null;
  /**
   * `true` dès la résiliation : l'accès payant reste actif jusqu'à
   * `currentPeriodEnd` (CLAUDE.md §5.8), et la suppression de compte est
   * débloquée immédiatement (CLAUDE.md §5.9).
   */
  cancelAtPeriodEnd: boolean;
  canceledAt: IsoDateTimeString | null;
}

/**
 * Projection du modèle technique `StoreNotificationEvent` (schéma §13).
 * Usage interne serveur (idempotence des notifications Google/Apple) — cette
 * structure n'est jamais renvoyée à l'application mobile.
 */
export interface StoreNotificationEventRecord {
  /** Identifiant fourni par le store : sert de clé d'idempotence. */
  id: string;
  store: StorePlatform;
  type: string;
  processedAt: IsoDateTimeString | null;
  createdAt: IsoDateTimeString;
}
