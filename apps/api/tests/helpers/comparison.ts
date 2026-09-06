import { tables } from './prisma-mock';

/**
 * Fabriques d'offres de comparaison pour les tests.
 *
 * Les valeurs sont figées : le comparateur est déterministe, les fixtures ne
 * doivent donc dépendre ni de l'horloge ni de l'ordre d'exécution.
 */
export interface OfferSeed {
  serviceName: string;
  country?: string;
  currency?: string;
  /** Prix vérifié, en représentation décimale exacte. */
  verifiedPrice: string;
  billingCycle?: 'MONTHLY' | 'YEARLY';
  lastVerifiedAt: string;
  nextCheckAt: string;
  affiliateNote?: string | null;
  affiliateUrl?: string | null;
  directOfficialUrl?: string;
  featuresIncluded?: string[];
  limits?: Record<string, string | number | boolean | null>;
  commitmentDuration?: number | null;
}

export async function seedOffer(seed: OfferSeed): Promise<string> {
  const row = (await tables.comparisonOffer.create({
    data: {
      serviceName: seed.serviceName,
      country: seed.country ?? 'FR',
      verifiedPrice: seed.verifiedPrice,
      currency: seed.currency ?? 'EUR',
      billingCycle: seed.billingCycle ?? 'MONTHLY',
      featuresIncluded: seed.featuresIncluded ?? ['hd'],
      limits: seed.limits ?? { screens: 1 },
      commitmentDuration: seed.commitmentDuration ?? null,
      directOfficialUrl: seed.directOfficialUrl ?? 'https://example.com/offer',
      lastVerifiedAt: new Date(seed.lastVerifiedAt),
      nextCheckAt: new Date(seed.nextCheckAt),
      affiliateNote: seed.affiliateNote ?? null,
      affiliateUrl: seed.affiliateUrl ?? null,
    },
  })) as { id: string };

  return row.id;
}

export interface ExpenseSeed {
  userId: string;
  merchant: string;
  dates: readonly string[];
  amount?: string;
  currency?: string;
  status?: 'ACTIVE' | 'CANCELLED' | 'TO_REVIEW';
}

/** Série de dépenses régulière, suffisante pour que le moteur la retienne. */
export async function seedSeries(seed: ExpenseSeed): Promise<string[]> {
  const ids: string[] = [];

  for (const date of seed.dates) {
    const row = (await tables.expense.create({
      data: {
        userId: seed.userId,
        merchantRaw: seed.merchant,
        merchantNormalized: seed.merchant,
        merchantOverride: null,
        amount: seed.amount ?? '15.99',
        currency: seed.currency ?? 'EUR',
        date: new Date(`${date}T00:00:00.000Z`),
        frequency: 'ONCE',
        category: 'STREAMING',
        status: seed.status ?? 'ACTIVE',
        source: 'IMPORT',
        importBatchId: null,
      },
    })) as { id: string };

    ids.push(row.id);
  }

  return ids;
}

/** Dates mensuelles régulières, du 5 de chaque mois. */
export const MONTHLY_DATES = [
  '2026-01-05',
  '2026-02-05',
  '2026-03-05',
  '2026-04-05',
  '2026-05-05',
  '2026-06-05',
] as const;
