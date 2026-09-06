import { PrismaClient, type BillingCycle, type Prisma } from '@prisma/client';

/**
 * Seed — `specs/schema-donnees.md` §14.
 *
 * Contenu strictement limité à des `ComparisonOffer` de démonstration :
 *  - aucune donnée personnelle, aucun `User`, aucun mot de passe, aucun token ;
 *  - aucune clé d'API réelle ;
 *  - jeu de données figé (dates et prix littéraux) pour rester reproductible.
 *
 * Ces offres servent uniquement au développement local et aux tests. Elles ne
 * constituent pas la base d'offres vérifiées de production : celle-ci est
 * alimentée manuellement offre par offre (CLAUDE.md §5.12 — jamais de prix
 * inventé, jamais d'offre obsolète présentée comme vérifiée).
 */

const prisma = new PrismaClient();

/** Date de vérification figée du jeu de démonstration. */
const LAST_VERIFIED_AT = new Date('2026-01-05T00:00:00.000Z');
/** Prochaine vérification : 90 jours après la précédente. */
const NEXT_CHECK_AT = new Date('2026-04-05T00:00:00.000Z');

interface DemoOffer {
  /** Identifiant stable, préfixé `seed_` : rend le seed idempotent. */
  id: string;
  serviceName: string;
  country: string;
  verifiedPrice: string;
  currency: string;
  billingCycle: BillingCycle;
  featuresIncluded: string[];
  limits: Record<string, string | number | boolean | null>;
  commitmentDuration: number | null;
  directOfficialUrl: string;
}

const DEMO_OFFERS: readonly DemoOffer[] = [
  {
    id: 'seed_netflix_standard_fr_monthly',
    serviceName: 'Netflix Standard',
    country: 'FR',
    verifiedPrice: '13.4900',
    currency: 'EUR',
    billingCycle: 'MONTHLY',
    featuresIncluded: ['hd_1080p', 'two_streams', 'downloads'],
    limits: { simultaneousStreams: 2, maxResolution: '1080p', ads: false },
    commitmentDuration: null,
    directOfficialUrl: 'https://www.netflix.com/fr/',
  },
  {
    id: 'seed_netflix_ads_fr_monthly',
    serviceName: 'Netflix Standard avec pub',
    country: 'FR',
    verifiedPrice: '5.9900',
    currency: 'EUR',
    billingCycle: 'MONTHLY',
    featuresIncluded: ['hd_1080p', 'two_streams'],
    limits: { simultaneousStreams: 2, maxResolution: '1080p', ads: true },
    commitmentDuration: null,
    directOfficialUrl: 'https://www.netflix.com/fr/',
  },
  {
    id: 'seed_spotify_individual_fr_monthly',
    serviceName: 'Spotify Premium Individuel',
    country: 'FR',
    verifiedPrice: '11.9900',
    currency: 'EUR',
    billingCycle: 'MONTHLY',
    featuresIncluded: ['ad_free', 'offline_mode', 'lossless_unavailable'],
    limits: { accounts: 1, offlineTracks: 10000 },
    commitmentDuration: null,
    directOfficialUrl: 'https://www.spotify.com/fr/premium/',
  },
  {
    id: 'seed_spotify_duo_fr_monthly',
    serviceName: 'Spotify Premium Duo',
    country: 'FR',
    verifiedPrice: '16.9900',
    currency: 'EUR',
    billingCycle: 'MONTHLY',
    featuresIncluded: ['ad_free', 'offline_mode', 'two_accounts'],
    limits: { accounts: 2, offlineTracks: 10000 },
    commitmentDuration: null,
    directOfficialUrl: 'https://www.spotify.com/fr/premium/',
  },
  {
    id: 'seed_disney_plus_standard_fr_monthly',
    serviceName: 'Disney+ Standard',
    country: 'FR',
    verifiedPrice: '9.9900',
    currency: 'EUR',
    billingCycle: 'MONTHLY',
    featuresIncluded: ['hd_1080p', 'two_streams', 'downloads'],
    limits: { simultaneousStreams: 2, maxResolution: '1080p', ads: false },
    commitmentDuration: null,
    directOfficialUrl: 'https://www.disneyplus.com/fr-fr',
  },
  {
    id: 'seed_disney_plus_standard_fr_yearly',
    serviceName: 'Disney+ Standard',
    country: 'FR',
    verifiedPrice: '99.9000',
    currency: 'EUR',
    billingCycle: 'YEARLY',
    featuresIncluded: ['hd_1080p', 'two_streams', 'downloads'],
    limits: { simultaneousStreams: 2, maxResolution: '1080p', ads: false },
    commitmentDuration: 12,
    directOfficialUrl: 'https://www.disneyplus.com/fr-fr',
  },
  {
    id: 'seed_google_one_100gb_fr_monthly',
    serviceName: 'Google One 100 Go',
    country: 'FR',
    verifiedPrice: '1.9900',
    currency: 'EUR',
    billingCycle: 'MONTHLY',
    featuresIncluded: ['cloud_storage', 'family_sharing'],
    limits: { storageGb: 100, familyMembers: 5 },
    commitmentDuration: null,
    directOfficialUrl: 'https://one.google.com/about/plans',
  },
  {
    id: 'seed_icloud_plus_200gb_fr_monthly',
    serviceName: 'iCloud+ 200 Go',
    country: 'FR',
    verifiedPrice: '2.9900',
    currency: 'EUR',
    billingCycle: 'MONTHLY',
    featuresIncluded: ['cloud_storage', 'family_sharing', 'private_relay'],
    limits: { storageGb: 200, familyMembers: 6 },
    commitmentDuration: null,
    directOfficialUrl: 'https://www.apple.com/fr/icloud/',
  },
  {
    id: 'seed_netflix_standard_us_monthly',
    serviceName: 'Netflix Standard',
    country: 'US',
    verifiedPrice: '17.9900',
    currency: 'USD',
    billingCycle: 'MONTHLY',
    featuresIncluded: ['hd_1080p', 'two_streams', 'downloads'],
    limits: { simultaneousStreams: 2, maxResolution: '1080p', ads: false },
    commitmentDuration: null,
    directOfficialUrl: 'https://www.netflix.com/',
  },
  {
    id: 'seed_spotify_individual_us_monthly',
    serviceName: 'Spotify Premium Individual',
    country: 'US',
    verifiedPrice: '11.9900',
    currency: 'USD',
    billingCycle: 'MONTHLY',
    featuresIncluded: ['ad_free', 'offline_mode'],
    limits: { accounts: 1, offlineTracks: 10000 },
    commitmentDuration: null,
    directOfficialUrl: 'https://www.spotify.com/us/premium/',
  },
  {
    id: 'seed_netflix_standard_gb_monthly',
    serviceName: 'Netflix Standard',
    country: 'GB',
    verifiedPrice: '12.9900',
    currency: 'GBP',
    billingCycle: 'MONTHLY',
    featuresIncluded: ['hd_1080p', 'two_streams', 'downloads'],
    limits: { simultaneousStreams: 2, maxResolution: '1080p', ads: false },
    commitmentDuration: null,
    directOfficialUrl: 'https://www.netflix.com/gb/',
  },
  {
    id: 'seed_spotify_individual_gb_monthly',
    serviceName: 'Spotify Premium Individual',
    country: 'GB',
    verifiedPrice: '11.9900',
    currency: 'GBP',
    billingCycle: 'MONTHLY',
    featuresIncluded: ['ad_free', 'offline_mode'],
    limits: { accounts: 1, offlineTracks: 10000 },
    commitmentDuration: null,
    directOfficialUrl: 'https://www.spotify.com/uk/premium/',
  },
];

function assertNotProduction(): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const isExplicitlyAllowed = process.env.ALLOW_DEMO_SEED === 'true';

  if (isProduction && !isExplicitlyAllowed) {
    throw new Error(
      "Seed de démonstration refusé en production. La base d'offres de production est " +
        'alimentée manuellement, offre par offre, avec des prix réellement vérifiés.',
    );
  }
}

async function main(): Promise<void> {
  assertNotProduction();

  for (const offer of DEMO_OFFERS) {
    const data = {
      serviceName: offer.serviceName,
      country: offer.country,
      verifiedPrice: offer.verifiedPrice,
      currency: offer.currency,
      billingCycle: offer.billingCycle,
      featuresIncluded: offer.featuresIncluded as unknown as Prisma.InputJsonValue,
      limits: offer.limits as unknown as Prisma.InputJsonValue,
      commitmentDuration: offer.commitmentDuration,
      directOfficialUrl: offer.directOfficialUrl,
      lastVerifiedAt: LAST_VERIFIED_AT,
      nextCheckAt: NEXT_CHECK_AT,
      // Aucune offre de démonstration n'est affiliée : les deux champs restent nuls.
      affiliateNote: null,
      affiliateUrl: null,
    } satisfies Omit<Prisma.ComparisonOfferCreateInput, 'id'>;

    await prisma.comparisonOffer.upsert({
      where: { id: offer.id },
      update: data,
      create: { id: offer.id, ...data },
    });
  }

  const total = await prisma.comparisonOffer.count();
  console.info(
    `Seed terminé : ${DEMO_OFFERS.length} offres de démonstration (total en base : ${total}).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('Seed échoué :', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
