import type { BillingCycle } from './enums';
import type { CommercializedPlan } from './plans';

/**
 * Tarifs de référence (`specs/paiement-in-app.md` §3).
 *
 * ⚠️ Ce ne sont **jamais** des prix de facturation. Le prix réellement payé est
 * celui défini dans Play Console / App Store Connect, localisé par pays par le
 * store lui-même. Ces valeurs servent de configuration de référence et de repli
 * d'affichage quand le SDK natif n'a pas encore renvoyé le prix localisé.
 *
 * Unités mineures entières, comme partout ailleurs (CLAUDE.md §5.2).
 */
export const PLANS = {
  FREE: { monthlyPriceMinor: 0n, yearlyPriceMinor: 0n },
  PLUS: { monthlyPriceMinor: 599n, yearlyPriceMinor: 4999n }, // EUR, unités mineures
} as const;

/** Devise des tarifs de référence ci-dessus. */
export const PLANS_REFERENCE_CURRENCY = 'EUR';

/**
 * Événements de facturation normalisés.
 *
 * Les deux stores parlent des langages différents (entiers pour Google,
 * chaînes + sous-types pour Apple) : ils sont traduits vers ce vocabulaire
 * unique, seul manipulé par le service de facturation.
 */
export const BILLING_EVENTS = [
  /** Premier achat d'un abonnement. */
  'PURCHASED',
  /** Renouvellement automatique réussi. */
  'RENEWED',
  /** Reprise après incident de paiement ou réactivation. */
  'RESTARTED',
  /**
   * Renouvellement automatique désactivé. **Ce n'est pas une fin d'accès** :
   * l'accès payant continue jusqu'à `currentPeriodEnd` (§6).
   */
  'CANCELED',
  /** Renouvellement automatique réactivé avant la fin de la période. */
  'RENEWAL_RESTORED',
  /** Échec de paiement, période de grâce ouverte par le store. */
  'GRACE_PERIOD',
  /** Échec de paiement non résolu : accès suspendu, sans résiliation. */
  'ON_HOLD',
  /** Abonnement mis en pause à la demande de l'utilisateur (Google uniquement). */
  'PAUSED',
  /** Fin effective de la période : c'est le seul retour à `FREE` (§6). */
  'EXPIRED',
] as const;

export type BillingEvent = (typeof BILLING_EVENTS)[number];

/** Formule commercialisée, telle qu'identifiée par un produit du store. */
export interface StoreProduct {
  plan: CommercializedPlan;
  billingCycle: BillingCycle;
}
