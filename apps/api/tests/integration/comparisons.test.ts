import type {
  AuthenticatedSessionDto,
  ComparisonDto,
  ComparisonListDto,
  ComparisonOfferMatchDto,
} from '@subscription-manager/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { GET as offersRoute } from '@/app/api/comparisons/[expenseId]/offers/route';
import { POST as refreshRoute } from '@/app/api/comparisons/[expenseId]/refresh/route';
import { GET as detailRoute } from '@/app/api/comparisons/[expenseId]/route';
import { GET as listRoute } from '@/app/api/comparisons/route';
import { resetRateLimits } from '@/lib/security/rate-limit';
import { comparisonService } from '@/server/services/comparison.service';
import { recurringDetectionService } from '@/server/services/recurring-detection.service';

import { MONTHLY_DATES, seedOffer, seedSeries } from '../helpers/comparison';
import { createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { resetDatabase } from '../helpers/prisma-mock';

/**
 * Comparateur d'offres, bout en bout
 * (`specs/comparateur-et-assistant-ia.md` A.2, A.5, A.6, A.7, checklist A.9).
 */
const NOW = new Date('2026-06-15T12:00:00.000Z');

/** Abonnement Netflix à 15,99 €/mois, détecté par le moteur déterministe. */
async function seedNetflixSubscription(userId: string): Promise<string> {
  const ids = await seedSeries({ userId, merchant: 'Netflix', dates: MONTHLY_DATES });

  await recurringDetectionService.refreshForUser(userId);

  return ids[ids.length - 1] ?? '';
}

function context(expenseId: string): { params: Promise<{ expenseId: string }> } {
  return { params: Promise.resolve({ expenseId }) };
}

describe('comparateur d’offres', () => {
  let session: AuthenticatedSessionDto;
  let other: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();

    session = await createUserWithSession({ email: 'comparateur@example.com', country: 'FR' });
    other = await createUserWithSession({ email: 'voisin@example.com', country: 'FR' });
  });

  it('exige une session valide', async () => {
    const response = await listRoute(apiRequest('/api/comparisons'));

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });

  it('affiche explicitement l’absence d’alternative plutôt qu’un résultat forcé', async () => {
    await seedNetflixSubscription(session.user.id);

    const result = await comparisonService.list(session.user, NOW);

    expect(result.comparisons).toHaveLength(1);
    expect(result.comparisons[0]?.offers).toEqual([]);
    expect(result.comparisons[0]?.bestSavings).toBeNull();
    expect(result.totalPotentialSavings.minorUnits).toBe('0');
  });

  it('calcule le coût actuel sur 12 mois et l’économie, au centime', async () => {
    await seedNetflixSubscription(session.user.id);
    await seedOffer({
      serviceName: 'Netflix',
      verifiedPrice: '7.99',
      lastVerifiedAt: '2026-06-01T00:00:00.000Z',
      nextCheckAt: '2026-07-01T00:00:00.000Z',
    });

    const [comparison] = (await comparisonService.list(session.user, NOW)).comparisons;

    // 15,99 × 12 = 191,88 ; 7,99 × 12 = 95,88 ; économie = 96,00.
    expect(comparison?.currentAnnualCost?.minorUnits).toBe('19188');
    expect(comparison?.offers[0]?.annualCost.minorUnits).toBe('9588');
    expect(comparison?.offers[0]?.potentialSavings.minorUnits).toBe('9600');
    expect(comparison?.bestSavings?.minorUnits).toBe('9600');
  });

  it('n’affiche jamais une économie négative pour une offre plus chère', async () => {
    await seedNetflixSubscription(session.user.id);
    await seedOffer({
      serviceName: 'Netflix',
      verifiedPrice: '25.99',
      lastVerifiedAt: '2026-06-01T00:00:00.000Z',
      nextCheckAt: '2026-07-01T00:00:00.000Z',
    });

    const [comparison] = (await comparisonService.list(session.user, NOW)).comparisons;

    expect(comparison?.offers[0]?.potentialSavings.minorUnits).toBe('0');
    expect(comparison?.offers[0]?.recommendable).toBe(false);
    expect(comparison?.bestSavings).toBeNull();
  });

  it('exclut des recommandations une offre dont la vérification est trop ancienne', async () => {
    await seedNetflixSubscription(session.user.id);
    await seedOffer({
      serviceName: 'Netflix',
      verifiedPrice: '7.99',
      // Vérifiée il y a plus de 30 jours : consultable, jamais recommandée.
      lastVerifiedAt: '2026-04-01T00:00:00.000Z',
      nextCheckAt: '2026-07-01T00:00:00.000Z',
    });

    const [comparison] = (await comparisonService.list(session.user, NOW)).comparisons;
    const offer = comparison?.offers[0];

    expect(offer?.freshness).toBe('STALE');
    expect(offer?.recommendable).toBe(false);
    // L'économie reste calculée et affichable : seule la recommandation
    // automatique est bloquée (A.6).
    expect(offer?.potentialSavings.minorUnits).toBe('9600');
    expect(comparison?.bestSavings).toBeNull();
  });

  it('transmet toujours les dates de vérification et le lien officiel', async () => {
    await seedNetflixSubscription(session.user.id);
    await seedOffer({
      serviceName: 'Netflix',
      verifiedPrice: '7.99',
      lastVerifiedAt: '2026-06-01T00:00:00.000Z',
      nextCheckAt: '2026-07-01T00:00:00.000Z',
      directOfficialUrl: 'https://www.netflix.com/fr/',
    });

    const [comparison] = (await comparisonService.list(session.user, NOW)).comparisons;
    const offer = comparison?.offers[0]?.offer;

    expect(offer?.lastVerifiedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(offer?.nextCheckAt).toBe('2026-07-01T00:00:00.000Z');
    expect(offer?.directOfficialUrl).toBe('https://www.netflix.com/fr/');
  });

  it('ne transmet un lien affilié qu’accompagné de sa mention de commission', async () => {
    await seedNetflixSubscription(session.user.id);
    await seedOffer({
      serviceName: 'Netflix',
      verifiedPrice: '7.99',
      lastVerifiedAt: '2026-06-01T00:00:00.000Z',
      nextCheckAt: '2026-07-01T00:00:00.000Z',
      affiliateUrl: 'https://partenaire.example.com/netflix',
      affiliateNote: 'Ce lien nous rapporte une commission.',
    });

    const offer = (await comparisonService.list(session.user, NOW)).comparisons[0]?.offers[0]
      ?.offer;

    expect(offer?.affiliateUrl).toBe('https://partenaire.example.com/netflix');
    expect(offer?.affiliateNote).toBe('Ce lien nous rapporte une commission.');
  });

  it('supprime un lien affilié orphelin de sa mention', async () => {
    await seedNetflixSubscription(session.user.id);
    await seedOffer({
      serviceName: 'Netflix',
      verifiedPrice: '7.99',
      lastVerifiedAt: '2026-06-01T00:00:00.000Z',
      nextCheckAt: '2026-07-01T00:00:00.000Z',
      affiliateUrl: 'https://partenaire.example.com/netflix',
      affiliateNote: null,
    });

    const offer = (await comparisonService.list(session.user, NOW)).comparisons[0]?.offers[0]
      ?.offer;

    expect(offer?.affiliateUrl).toBeNull();
  });

  it('classe les offres par prix, indépendamment de la commission', async () => {
    await seedNetflixSubscription(session.user.id);
    await seedOffer({
      serviceName: 'Netflix',
      verifiedPrice: '12.99',
      lastVerifiedAt: '2026-06-01T00:00:00.000Z',
      nextCheckAt: '2026-07-01T00:00:00.000Z',
      affiliateUrl: 'https://partenaire.example.com/cher',
      affiliateNote: 'Commission.',
    });
    await seedOffer({
      serviceName: 'Netflix',
      verifiedPrice: '5.99',
      lastVerifiedAt: '2026-06-01T00:00:00.000Z',
      nextCheckAt: '2026-07-01T00:00:00.000Z',
    });

    const offers = (await comparisonService.list(session.user, NOW)).comparisons[0]?.offers ?? [];

    expect(offers.map((entry: ComparisonOfferMatchDto) => entry.offer.price.minorUnits)).toEqual([
      '599',
      '1299',
    ]);
  });

  it('ignore les offres d’un autre pays', async () => {
    await seedNetflixSubscription(session.user.id);
    await seedOffer({
      serviceName: 'Netflix',
      country: 'US',
      currency: 'EUR',
      verifiedPrice: '5.99',
      lastVerifiedAt: '2026-06-01T00:00:00.000Z',
      nextCheckAt: '2026-07-01T00:00:00.000Z',
    });

    const [comparison] = (await comparisonService.list(session.user, NOW)).comparisons;

    expect(comparison?.offers).toEqual([]);
  });

  it('sert le détail et les offres d’un abonnement par ses routes', async () => {
    const expenseId = await seedNetflixSubscription(session.user.id);
    await seedOffer({
      serviceName: 'Netflix',
      verifiedPrice: '7.99',
      lastVerifiedAt: '2026-06-01T00:00:00.000Z',
      nextCheckAt: '2027-07-01T00:00:00.000Z',
    });

    const detail = await expectSuccess<ComparisonDto>(
      await detailRoute(
        apiRequest(`/api/comparisons/${expenseId}`, { token: session.token }),
        context(expenseId),
      ),
    );

    expect(detail.expenseId).toBe(expenseId);
    expect(detail.offers).toHaveLength(1);

    const offers = await expectSuccess<{ offers: ComparisonOfferMatchDto[] }>(
      await offersRoute(
        apiRequest(`/api/comparisons/${expenseId}/offers`, { token: session.token }),
        context(expenseId),
      ),
    );

    expect(offers.offers).toHaveLength(1);

    const refreshed = await expectSuccess<ComparisonDto>(
      await refreshRoute(
        apiRequest(`/api/comparisons/${expenseId}/refresh`, {
          method: 'POST',
          token: session.token,
        }),
        context(expenseId),
      ),
    );

    // Le rafraîchissement rejoue le matching : même base, même résultat.
    expect(refreshed.offers).toHaveLength(1);
  });

  it('traite comme inexistant l’abonnement d’un autre utilisateur', async () => {
    const expenseId = await seedNetflixSubscription(other.user.id);

    const response = await detailRoute(
      apiRequest(`/api/comparisons/${expenseId}`, { token: session.token }),
      context(expenseId),
    );

    expect(await expectErrorCode(response)).toBe('NOT_FOUND');
  });

  it('ne renvoie jamais les abonnements d’un autre utilisateur dans la liste', async () => {
    await seedNetflixSubscription(other.user.id);
    await seedSeries({ userId: session.user.id, merchant: 'Spotify', dates: MONTHLY_DATES });
    await recurringDetectionService.refreshForUser(session.user.id);

    const result = await expectSuccess<ComparisonListDto>(
      await listRoute(apiRequest('/api/comparisons', { token: session.token })),
    );

    expect(result.comparisons.map((entry) => entry.merchant)).toEqual(['Spotify']);
  });
});
