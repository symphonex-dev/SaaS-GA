import type { OfferAuditAction, OfferFreshness, OfferMatchKind } from '../constants/comparison';
import type { CountryCode } from '../constants/countries';
import type { BillingCycle } from '../constants/enums';
import type { Id, IsoDateTimeString, MoneyDto } from './common';

/** Valeur admise dans les colonnes `Json` de `ComparisonOffer`. */
export type OfferJsonValue = string | number | boolean | null;

/** `ComparisonOffer.featuresIncluded` : liste de clés de fonctionnalités. */
export type OfferFeatures = string[];

/** `ComparisonOffer.limits` : dictionnaire plat de limites (quota, débit, etc.). */
export type OfferLimits = Record<string, OfferJsonValue>;

/**
 * Projection du modèle `ComparisonOffer` (schéma §7).
 *
 * Base restreinte et vérifiée : jamais de prix inventé, jamais d'offre obsolète
 * présentée comme vérifiée (CLAUDE.md §5.12).
 */
export interface ComparisonOfferDto {
  id: Id;
  serviceName: string;
  country: CountryCode;
  price: MoneyDto;
  billingCycle: BillingCycle;
  featuresIncluded: OfferFeatures;
  limits: OfferLimits;
  /** Durée d'engagement en mois, `null` si sans engagement. */
  commitmentDuration: number | null;
  directOfficialUrl: string;
  lastVerifiedAt: IsoDateTimeString;
  nextCheckAt: IsoDateTimeString;
  affiliateNote: string | null;
  affiliateUrl: string | null;
}

/**
 * Offre alternative rapprochée d'un abonnement de l'utilisateur (A.5).
 *
 * Tous les montants sont calculés par `apps/api` en unités mineures entières :
 * le mobile n'en recalcule aucun (CLAUDE.md §5.1). Une économie négative
 * n'existe pas — elle est ramenée à zéro avant transport (A.4).
 */
export interface ComparisonOfferMatchDto {
  offer: ComparisonOfferDto;
  /** `EXACT` = correspondance confirmée ; `SUGGESTED` = piste à valider (A.3). */
  matchKind: OfferMatchKind;
  /** Fraîcheur de la vérification (A.6) : une offre `STALE` n'est jamais recommandée. */
  freshness: OfferFreshness;
  /** Coût mensuel de l'offre, ramené au mois pour une formule annuelle. */
  monthlyCost: MoneyDto;
  /** Coût de l'offre sur 12 mois. */
  annualCost: MoneyDto;
  /** `max(coût actuel 12 mois − coût alternatif 12 mois, 0)` — jamais négatif. */
  potentialSavings: MoneyDto;
  /** Part économisée, en pourcentage exact ; `null` si le coût actuel est nul. */
  potentialSavingsPercentage: string | null;
  /**
   * `true` uniquement si l'offre est `EXACT`, `FRESH` et strictement moins
   * chère : seules ces offres alimentent une recommandation automatique (A.6).
   */
  recommendable: boolean;
}

/**
 * Un abonnement de l'utilisateur et ses alternatives vérifiées (A.5).
 *
 * `offers` vide signifie « aucune alternative vérifiée disponible » : ce cas
 * est affiché explicitement, jamais comblé par un résultat forcé (A.2).
 */
export interface ComparisonDto {
  expenseId: Id;
  merchant: string;
  /** Clé de rapprochement (commerçant normalisé), exposée pour le débogage. */
  merchantNormalized: string;
  country: CountryCode;
  currency: MoneyDto['currency'];
  /** Formule actuelle détectée par le moteur déterministe. */
  currentBillingCycle: BillingCycle | null;
  currentAmount: MoneyDto;
  currentMonthlyCost: MoneyDto | null;
  /** Coût actuel sur 12 mois ; `null` pour une série irrégulière. */
  currentAnnualCost: MoneyDto | null;
  offers: ComparisonOfferMatchDto[];
  /** Meilleure économie annuelle parmi les offres recommandables ; `null` si aucune. */
  bestSavings: MoneyDto | null;
  generatedAt: IsoDateTimeString;
}

/** `GET /api/comparisons` (A.7). */
export interface ComparisonListDto {
  comparisons: ComparisonDto[];
  /** Total des meilleures économies annuelles, dans la devise de l'utilisateur. */
  totalPotentialSavings: MoneyDto;
  generatedAt: IsoDateTimeString;
}

/** Trace d'administration d'une offre (A.8) : qui, quand, avant/après. */
export interface ComparisonOfferAuditDto {
  id: Id;
  offerId: Id;
  action: OfferAuditAction;
  actorEmail: string;
  before: ComparisonOfferDto | null;
  after: ComparisonOfferDto | null;
  createdAt: IsoDateTimeString;
}
