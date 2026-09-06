import { grantsPaidAccess, type CommercializedPlan } from '@subscription-manager/shared';
import type { Subscription } from '@prisma/client';

/**
 * Entitlements par offre (`specs/paiement-in-app.md` §2 et §7).
 *
 * Configuration **centralisée côté serveur** : toute fonctionnalité payante est
 * contrôlée ici, jamais par un état local de l'application mobile. Le mobile
 * reçoit les droits déjà résolus et ne fait que les afficher.
 */
export interface Entitlements {
  maxCsvImportsPerMonth: number | null;
  pdfImportEnabled: boolean;
  maxTrackedSubscriptions: number | null;
  priceIncreaseAlerts: boolean;
  advancedComparisons: boolean;
  savingsGoalsLimit: number | null;
  fullHistory: boolean;
  aiMonthlyCredits: number;
}

/**
 * Essai PDF de l'offre Free : nombre total d'imports PDF autorisés sur la vie
 * du compte (« Test/limité » dans la matrice §2). Au-delà, le PDF exige Plus.
 */
export const FREE_PDF_TRIAL_IMPORTS = 1;

const FREE_ENTITLEMENTS: Entitlements = {
  maxCsvImportsPerMonth: 1,
  pdfImportEnabled: false,
  maxTrackedSubscriptions: 5,
  priceIncreaseAlerts: false,
  advancedComparisons: false,
  savingsGoalsLimit: 1,
  fullHistory: false,
  aiMonthlyCredits: 3,
};

const PLUS_ENTITLEMENTS: Entitlements = {
  maxCsvImportsPerMonth: null,
  pdfImportEnabled: true,
  maxTrackedSubscriptions: null,
  priceIncreaseAlerts: true,
  advancedComparisons: true,
  savingsGoalsLimit: null,
  fullHistory: true,
  aiMonthlyCredits: 30,
};

export function getEntitlements(plan: CommercializedPlan): Entitlements {
  return plan === 'PLUS' ? PLUS_ENTITLEMENTS : FREE_ENTITLEMENTS;
}

/**
 * Offre réellement en vigueur à un instant donné.
 *
 * C'est la seule fonction autorisée à répondre « Free ou Plus ? ». Elle
 * applique, dans cet ordre :
 *
 *  1. pas d'abonnement, ou plan non payant → `FREE` ;
 *  2. statut ne donnant pas accès au payant (`ON_HOLD`, `PAUSED`, `EXPIRED`…)
 *     → `FREE`. Un incident de paiement n'est pas une résiliation
 *     (`specs/paiement-in-app.md` §5), mais il suspend bien l'accès ;
 *  3. période déjà échue → `FREE`. C'est le **filet de secours** de §6, pour
 *     le cas où la notification d'expiration du store n'arriverait jamais ; il
 *     donne exactement le même résultat que le job planifié, sans dépendre de
 *     son exécution ;
 *  4. sinon → le plan de l'abonnement.
 *
 * Conséquence voulue de §6 : une résiliation ne change ni le plan ni le statut,
 * donc `cancelAtPeriodEnd === true` continue de renvoyer `PLUS` tant que
 * `currentPeriodEnd` n'est pas atteinte.
 */
export function effectivePlan(
  subscription: Subscription | null,
  now: Date = new Date(),
): CommercializedPlan {
  if (subscription === null || subscription.plan !== 'PLUS') {
    return 'FREE';
  }

  if (!grantsPaidAccess(subscription.status)) {
    return 'FREE';
  }

  if (
    subscription.currentPeriodEnd !== null &&
    subscription.currentPeriodEnd.getTime() <= now.getTime()
  ) {
    return 'FREE';
  }

  return 'PLUS';
}

/** Droits en vigueur pour un abonnement, à un instant donné. */
export function entitlementsFor(
  subscription: Subscription | null,
  now: Date = new Date(),
): Entitlements {
  return getEntitlements(effectivePlan(subscription, now));
}
