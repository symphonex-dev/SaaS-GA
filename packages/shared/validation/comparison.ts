import { z } from 'zod';

import { BILLING_CYCLES } from '../constants/enums';
import { countrySchema, httpsUrlSchema, isoDateTimeSchema, positiveMoneySchema } from './common';

export const billingCycleSchema = z.enum(BILLING_CYCLES);

/** `ComparisonOffer.featuresIncluded` : clés de fonctionnalités, dédoublonnées. */
export const offerFeaturesSchema = z
  .array(z.string().trim().min(1).max(80))
  .max(50)
  .refine((features) => new Set(features).size === features.length, 'DUPLICATE_FEATURE');

/** `ComparisonOffer.limits` : dictionnaire plat (aucune structure imbriquée). */
export const offerLimitsSchema = z.record(
  z.string().trim().min(1).max(80),
  z.union([z.string().max(200), z.number(), z.boolean(), z.null()]),
);

/**
 * Écriture d'une `ComparisonOffer` (schéma §7).
 *
 * Garde-fous V1 (CLAUDE.md §5.12) : offre vérifiée à la main, prix jamais
 * inventé ni généré par IA, `lastVerifiedAt` obligatoire et antérieur à
 * `nextCheckAt`.
 */
export const comparisonOfferInputSchema = z
  .object({
    serviceName: z.string().trim().min(1).max(120),
    country: countrySchema,
    price: positiveMoneySchema,
    billingCycle: billingCycleSchema,
    featuresIncluded: offerFeaturesSchema,
    limits: offerLimitsSchema,
    /** Durée d'engagement en mois ; `null` = sans engagement. */
    commitmentDuration: z.number().int().min(1).max(60).nullish(),
    directOfficialUrl: httpsUrlSchema,
    lastVerifiedAt: isoDateTimeSchema,
    nextCheckAt: isoDateTimeSchema,
    affiliateNote: z.string().trim().min(1).max(300).nullish(),
    affiliateUrl: httpsUrlSchema.nullish(),
  })
  .refine(
    (offer) => Date.parse(offer.nextCheckAt) > Date.parse(offer.lastVerifiedAt),
    'NEXT_CHECK_MUST_FOLLOW_LAST_VERIFICATION',
  )
  .refine(
    (offer) => offer.affiliateUrl == null || offer.affiliateNote != null,
    'AFFILIATE_URL_REQUIRES_NOTE',
  );

export type ComparisonOfferInput = z.infer<typeof comparisonOfferInputSchema>;

/**
 * Mise à jour partielle d'une offre (`PATCH /api/admin/comparison-offers/[id]`).
 *
 * Les invariants de `comparisonOfferInputSchema` ne peuvent pas être vérifiés
 * champ par champ (ils portent sur des couples de champs) : ils sont
 * revalidés côté service sur l'offre **fusionnée**, jamais sur le seul patch.
 */
export const comparisonOfferPatchSchema = z
  .object({
    serviceName: z.string().trim().min(1).max(120),
    country: countrySchema,
    price: positiveMoneySchema,
    billingCycle: billingCycleSchema,
    featuresIncluded: offerFeaturesSchema,
    limits: offerLimitsSchema,
    commitmentDuration: z.number().int().min(1).max(60).nullish(),
    directOfficialUrl: httpsUrlSchema,
    lastVerifiedAt: isoDateTimeSchema,
    nextCheckAt: isoDateTimeSchema,
    affiliateNote: z.string().trim().min(1).max(300).nullish(),
    affiliateUrl: httpsUrlSchema.nullish(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'EMPTY_PATCH');

export type ComparisonOfferPatch = z.infer<typeof comparisonOfferPatchSchema>;

/**
 * `POST /api/admin/comparison-offers/[id]/verify` : l'administrateur atteste
 * avoir revérifié le prix à la main.
 *
 * Le prix peut avoir changé depuis la dernière vérification : il est alors
 * fourni ici. Sans prix, seule la date de vérification est repoussée — le
 * montant reste celui déjà vérifié, jamais une valeur devinée (A.1).
 */
export const comparisonOfferVerifySchema = z.object({
  verifiedAt: isoDateTimeSchema,
  nextCheckAt: isoDateTimeSchema,
  price: positiveMoneySchema.optional(),
});

export type ComparisonOfferVerifyInput = z.infer<typeof comparisonOfferVerifySchema>;

/** Filtres de `GET /api/admin/comparison-offers`. */
export const comparisonOfferQuerySchema = z.object({
  country: countrySchema.optional(),
  serviceName: z.string().trim().min(1).max(120).optional(),
});

export type ComparisonOfferQuery = z.infer<typeof comparisonOfferQuerySchema>;
