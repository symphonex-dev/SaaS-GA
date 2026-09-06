import {
  DEFAULT_COUNTRY,
  ERROR_CODES,
  annualizeRecurring,
  countrySchema,
  monthlyFromAnnual,
  sumMoney,
  zeroMoney,
  type AuthenticatedUser,
  type BillingCycle,
  type ComparisonDto,
  type ComparisonListDto,
  type ComparisonOfferDto,
  type ComparisonOfferMatchDto,
  type CountryCode,
  type Currency,
  type ExpenseFrequency,
  type Money,
  type MoneyDto,
  type OfferLimits,
  type RecurringSummaryDto,
} from '@subscription-manager/shared';
import type { ComparisonOffer } from '@prisma/client';

import { AppError } from '@/lib/api/errors';
import {
  annualCost,
  monthlyCost,
  potentialAnnualSavings,
  savingsPercentage,
} from '@/lib/comparison/costs';
import {
  matchComparisonOffers,
  matchKind,
  offerFreshness,
  type ComparableOffer,
} from '@/lib/comparison/matching';
import { resolveCurrency } from '@/lib/finance/currency';
import { decimalToMoney, moneyToDto } from '@/lib/finance/money';
import { comparisonRepository } from '@/server/repositories/comparison.repository';
import { dashboardService } from '@/server/services/dashboard.service';

/**
 * Comparateur d'offres (`specs/comparateur-et-assistant-ia.md` partie A).
 *
 * Le service ne calcule rien lui-même : il charge les abonnements déjà
 * détectés par le moteur déterministe, délègue le rapprochement au module pur
 * `lib/comparison/matching` et les coûts à `lib/comparison/costs`.
 *
 * Aucune offre n'est générée : tout provient de `ComparisonOffer`, alimentée à
 * la main (A.1). Si aucune alternative fiable n'existe, la liste d'offres est
 * simplement vide — jamais comblée par un résultat forcé (A.2).
 */

/** Périodicité facturable équivalente ; `null` si la série n'en a pas. */
function billingCycleOf(frequency: ExpenseFrequency): BillingCycle | null {
  if (frequency === 'MONTHLY') {
    return 'MONTHLY';
  }

  return frequency === 'YEARLY' ? 'YEARLY' : null;
}

function resolveCountry(value: string): CountryCode {
  const parsed = countrySchema.safeParse(value);

  return parsed.success ? parsed.data : DEFAULT_COUNTRY;
}

function toComparableOffer(offer: ComparisonOffer, currency: Currency): ComparableOffer | null {
  const price = decimalToMoney(offer.verifiedPrice, currency);

  if (price === null || offer.currency !== currency) {
    return null;
  }

  return {
    id: offer.id,
    serviceName: offer.serviceName,
    country: offer.country,
    currency: offer.currency,
    verifiedPriceMinor: price.amountMinor,
    billingCycle: offer.billingCycle,
    lastVerifiedAt: offer.lastVerifiedAt,
    nextCheckAt: offer.nextCheckAt,
  };
}

/**
 * Projection publique d'une offre (A.5).
 *
 * Les colonnes `Json` de Prisma sont typées `JsonValue` : elles sont ramenées
 * à la forme attendue par le DTO, avec repli sur une valeur vide plutôt qu'un
 * plantage si la ligne a été écrite hors des routes d'administration.
 */
export function toOfferDto(offer: ComparisonOffer): ComparisonOfferDto {
  const currency = resolveCurrency(offer.currency);
  const price = decimalToMoney(offer.verifiedPrice, currency);

  return {
    id: offer.id,
    serviceName: offer.serviceName,
    // `country` est une colonne `String` : elle est revalidee ici, comme
    // partout ailleurs aux frontieres (voir `toAuthenticatedUser`). Une offre
    // au pays illisible ne correspondra de toute facon a aucun utilisateur.
    country: resolveCountry(offer.country),
    price: moneyToDto(price ?? zeroMoney(currency)),
    billingCycle: offer.billingCycle,
    featuresIncluded: Array.isArray(offer.featuresIncluded)
      ? offer.featuresIncluded.filter((entry) => typeof entry === 'string')
      : [],
    limits:
      offer.limits !== null && typeof offer.limits === 'object' && !Array.isArray(offer.limits)
        ? (offer.limits as OfferLimits)
        : {},
    commitmentDuration: offer.commitmentDuration,
    directOfficialUrl: offer.directOfficialUrl,
    // Fraîcheur et provenance accompagnent toujours l'offre : le client doit
    // pouvoir les afficher sur chaque ligne (A.5).
    lastVerifiedAt: offer.lastVerifiedAt.toISOString(),
    nextCheckAt: offer.nextCheckAt.toISOString(),
    // Un lien affilié ne circule jamais sans sa mention de commission, et
    // réciproquement : l'un ne va pas sans l'autre (A.5).
    affiliateNote: offer.affiliateUrl === null ? null : offer.affiliateNote,
    affiliateUrl: offer.affiliateNote === null ? null : offer.affiliateUrl,
  };
}

/** Abonnements éligibles au comparateur : récurrences confirmées et actives (A.2). */
function eligibleSubscriptions(
  subscriptions: readonly RecurringSummaryDto[],
): RecurringSummaryDto[] {
  return subscriptions.filter(
    (subscription) =>
      subscription.status !== 'REJECTED' &&
      subscription.expenseStatus === 'ACTIVE' &&
      subscription.frequency !== 'ONCE',
  );
}

/**
 * Reconstruit un `Money` depuis un DTO déjà produit par le serveur.
 *
 * Ce n'est pas un calcul côté client : la valeur a été arrêtée par le moteur
 * financier quelques lignes plus haut, et repasse simplement en `bigint` pour
 * être comparée (CLAUDE.md §5.2).
 */
function moneyFromDto(value: MoneyDto): Money {
  return { amountMinor: BigInt(value.minorUnits), currency: value.currency };
}

function buildOfferMatch(
  offer: ComparisonOffer,
  comparable: ComparableOffer,
  subscription: RecurringSummaryDto,
  currentAnnual: Money | null,
  currency: Currency,
  now: Date,
): ComparisonOfferMatchDto | null {
  const price = decimalToMoney(offer.verifiedPrice, currency);

  if (price === null) {
    return null;
  }

  const kind = matchKind(subscription.merchant, offer.serviceName);

  if (kind === null) {
    return null;
  }

  const freshness = offerFreshness(comparable, now);
  const offerAnnual = annualCost(price, offer.billingCycle);
  const offerMonthly = monthlyCost(price, offer.billingCycle);
  const savings =
    currentAnnual === null ? null : potentialAnnualSavings(currentAnnual, offerAnnual);

  return {
    offer: toOfferDto(offer),
    matchKind: kind,
    freshness,
    monthlyCost: moneyToDto(offerMonthly ?? zeroMoney(currency)),
    annualCost: moneyToDto(offerAnnual),
    potentialSavings: moneyToDto(savings ?? zeroMoney(currency)),
    potentialSavingsPercentage:
      savings === null || currentAnnual === null ? null : savingsPercentage(savings, currentAnnual),
    // Recommandable seulement si la correspondance est confirmée, la
    // vérification récente et l'économie strictement positive (A.3 et A.6).
    // Une offre `SUGGESTED` ou `STALE` reste consultable, mais n'alimente
    // aucune recommandation automatique.
    recommendable:
      kind === 'EXACT' && freshness === 'FRESH' && savings !== null && savings.amountMinor > 0n,
  };
}

function buildComparison(
  subscription: RecurringSummaryDto,
  offers: readonly ComparisonOffer[],
  user: AuthenticatedUser,
  currency: Currency,
  now: Date,
): ComparisonDto {
  const comparables = offers.flatMap((offer) => {
    const comparable = toComparableOffer(offer, currency);

    return comparable === null ? [] : [{ offer, comparable }];
  });

  const matched = matchComparisonOffers(
    { merchantNormalized: subscription.merchant, country: user.country, currency, now },
    comparables.map((entry) => entry.comparable),
  );

  const currentAmount = moneyFromDto(subscription.amount);
  const currentAnnual =
    subscription.annualCost === null
      ? annualizeRecurring(currentAmount, subscription.frequency)
      : moneyFromDto(subscription.annualCost);

  const matches = matched.flatMap((comparable) => {
    const source = comparables.find((entry) => entry.comparable.id === comparable.id);

    if (source === undefined) {
      return [];
    }

    const match = buildOfferMatch(
      source.offer,
      comparable,
      subscription,
      currentAnnual,
      currency,
      now,
    );

    return match === null ? [] : [match];
  });

  const best = matches
    .filter((match) => match.recommendable)
    .reduce<Money | null>((bestSoFar, match) => {
      const savings = moneyFromDto(match.potentialSavings);

      return bestSoFar === null || savings.amountMinor > bestSoFar.amountMinor
        ? savings
        : bestSoFar;
    }, null);

  const currentMonthly = currentAnnual === null ? null : monthlyFromAnnual(currentAnnual);

  return {
    expenseId: subscription.expenseId,
    merchant: subscription.merchant,
    merchantNormalized: subscription.merchant,
    country: user.country,
    currency,
    currentBillingCycle: billingCycleOf(subscription.frequency),
    currentAmount: subscription.amount,
    currentMonthlyCost: currentMonthly === null ? null : moneyToDto(currentMonthly),
    currentAnnualCost: currentAnnual === null ? null : moneyToDto(currentAnnual),
    offers: matches,
    bestSavings: best === null ? null : moneyToDto(best),
    generatedAt: now.toISOString(),
  };
}

export const comparisonService = {
  /** `GET /api/comparisons` — tous les abonnements et leurs alternatives (A.7). */
  async list(user: AuthenticatedUser, now: Date = new Date()): Promise<ComparisonListDto> {
    const currency = resolveCurrency(user.currency);
    const [subscriptions, offers] = await Promise.all([
      dashboardService.listSubscriptions(user),
      comparisonRepository.listCandidates(user.country, now),
    ]);

    const comparisons = eligibleSubscriptions(subscriptions).map((subscription) =>
      buildComparison(subscription, offers, user, currency, now),
    );

    const best = comparisons.flatMap((comparison) =>
      comparison.bestSavings === null ? [] : [moneyFromDto(comparison.bestSavings)],
    );

    return {
      comparisons,
      totalPotentialSavings: moneyToDto(sumMoney(best, currency)),
      generatedAt: now.toISOString(),
    };
  },

  /**
   * `GET /api/comparisons/[expenseId]` — comparaison d'un abonnement précis.
   *
   * Le `userId` provient exclusivement de la session (A.7) : une dépense qui
   * n'appartient pas à l'utilisateur est traitée comme inexistante.
   */
  async detail(
    user: AuthenticatedUser,
    expenseId: string,
    now: Date = new Date(),
  ): Promise<ComparisonDto> {
    const currency = resolveCurrency(user.currency);
    const subscriptions = eligibleSubscriptions(await dashboardService.listSubscriptions(user));
    const subscription = subscriptions.find((entry) => entry.expenseId === expenseId);

    if (subscription === undefined) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Abonnement introuvable.', 'expenseId');
    }

    const offers = await comparisonRepository.listCandidates(user.country, now);

    return buildComparison(subscription, offers, user, currency, now);
  },

  /** `GET /api/comparisons/[expenseId]/offers` — uniquement les alternatives. */
  async offers(
    user: AuthenticatedUser,
    expenseId: string,
    now: Date = new Date(),
  ): Promise<{ offers: ComparisonOfferMatchDto[] }> {
    const comparison = await comparisonService.detail(user, expenseId, now);

    return { offers: comparison.offers };
  },

  /**
   * `POST /api/comparisons/[expenseId]/refresh` — recalcule le rapprochement.
   *
   * En V1, « rafraîchir » signifie **rejouer le matching sur la base d'offres
   * actuelle**, jamais interroger un site marchand : aucun prix n'est collecté
   * automatiquement, la base est alimentée à la main (A.1). Une offre périmée
   * entre-temps disparaît donc du résultat, et une offre revérifiée par un
   * administrateur y réapparaît.
   */
  async refresh(
    user: AuthenticatedUser,
    expenseId: string,
    now: Date = new Date(),
  ): Promise<ComparisonDto> {
    return comparisonService.detail(user, expenseId, now);
  },
};
