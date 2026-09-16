import {
  COMPARISON_OFFER_MAX_AGE_MS,
  type BillingCycle,
  type OfferFreshness,
  type OfferMatchKind,
} from '@subscription-manager/shared';

import { merchantComparisonKey, tokenize } from '@/lib/merchant/normalize';

/**
 * Matching déterministe du comparateur
 * (`specs/comparateur-et-assistant-ia.md` A.3).
 *
 * Module **pur** : aucune base, aucun réseau, aucune IA. Deux exécutions sur
 * la même entrée donnent exactement le même résultat, dans le même ordre.
 * Aucune similarité sémantique n'intervient : deux libellés qui ne se
 * réduisent pas à la même clé normalisée ne sont jamais une correspondance
 * confirmée.
 */

/** Vue minimale d'une offre, indépendante de Prisma pour rester testable. */
export interface ComparableOffer {
  id: string;
  serviceName: string;
  country: string;
  currency: string;
  /** Prix vérifié en unités mineures entières — jamais un flottant. */
  verifiedPriceMinor: bigint;
  billingCycle: BillingCycle;
  lastVerifiedAt: Date;
  nextCheckAt: Date;
}

export interface MatchingContext {
  /** Commerçant déjà normalisé par le pipeline d'import (§9 import-releves). */
  merchantNormalized: string;
  country: string;
  currency: string;
  now: Date;
}

/**
 * Fraîcheur d'une offre (A.6).
 *
 * `EXPIRED` prime sur `STALE` : une offre dont la date de prochaine
 * vérification est dépassée sort du matching, elle n'est même plus consultable
 * comme alternative.
 */
export function offerFreshness(
  offer: Pick<ComparableOffer, 'lastVerifiedAt' | 'nextCheckAt'>,
  now: Date,
): OfferFreshness {
  if (offer.nextCheckAt.getTime() < now.getTime()) {
    return 'EXPIRED';
  }

  const age = now.getTime() - offer.lastVerifiedAt.getTime();

  return age <= COMPARISON_OFFER_MAX_AGE_MS ? 'FRESH' : 'STALE';
}

/** Raccourci lisible de la règle A.6 (`isFresh`). */
export function isFreshOffer(offer: ComparableOffer, now: Date): boolean {
  return offerFreshness(offer, now) === 'FRESH';
}

/**
 * Nature du rapprochement entre un commerçant et une offre (A.3).
 *
 * `EXACT` : les deux libellés se réduisent à la même clé normalisée.
 * `SUGGESTED` : l'un des deux libellés est un préfixe de jetons de l'autre
 *   (« Netflix » ↔ « Netflix Standard »). C'est une **piste à vérifier**,
 *   jamais une correspondance confirmée sans validation de l'utilisateur.
 * `null` : aucun rapprochement.
 */
export function matchKind(merchantNormalized: string, serviceName: string): OfferMatchKind | null {
  const merchantKey = merchantComparisonKey(merchantNormalized);
  const serviceKey = merchantComparisonKey(serviceName);

  if (merchantKey.length === 0 || serviceKey.length === 0) {
    return null;
  }

  if (merchantKey === serviceKey) {
    return 'EXACT';
  }

  const merchantTokens = tokenize(merchantNormalized);
  const serviceTokens = tokenize(serviceName);
  const [shorter, longer] =
    merchantTokens.length <= serviceTokens.length
      ? [merchantTokens, serviceTokens]
      : [serviceTokens, merchantTokens];

  if (shorter.length === 0) {
    return null;
  }

  return shorter.every((token, index) => longer[index] === token) ? 'SUGGESTED' : null;
}

/**
 * Ordre total et stable : prix croissant, puis nom de service, puis
 * identifiant.
 *
 * Le classement ne dépend **jamais** de l'existence d'un lien d'affiliation
 * (A.2) : la commission n'entre dans aucun critère de tri.
 */
function compareOffers(left: ComparableOffer, right: ComparableOffer): number {
  if (left.verifiedPriceMinor !== right.verifiedPriceMinor) {
    // Comparaison directe entre `bigint` : convertir en `number` pour trier
    // ferait passer un montant par un flottant (CLAUDE.md §5.2).
    return left.verifiedPriceMinor < right.verifiedPriceMinor ? -1 : 1;
  }

  const byName = left.serviceName.localeCompare(right.serviceName);

  return byName !== 0 ? byName : left.id.localeCompare(right.id);
}

/**
 * Offres rapprochées d'un abonnement (A.3).
 *
 * Filtres appliqués, dans cet ordre : même pays, même devise, offre non
 * expirée, libellé rapproché. La devise s'ajoute à la lettre de la spec A.3
 * mais découle de A.2 (« filtrées par pays et devise ») : comparer un prix en
 * EUR à un prix en USD n'a aucun sens tant qu'aucun taux de change n'existe
 * (`specs/calculs-financiers.md` §7).
 */
export function matchComparisonOffers(
  context: MatchingContext,
  offers: readonly ComparableOffer[],
): ComparableOffer[] {
  return offers
    .filter((offer) => offer.country === context.country)
    .filter((offer) => offer.currency === context.currency)
    .filter((offer) => offer.nextCheckAt.getTime() >= context.now.getTime())
    .filter((offer) => matchKind(context.merchantNormalized, offer.serviceName) !== null)
    .sort(compareOffers);
}
