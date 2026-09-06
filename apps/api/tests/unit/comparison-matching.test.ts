import { COMPARISON_OFFER_MAX_AGE_DAYS, money } from '@subscription-manager/shared';
import { describe, expect, it } from 'vitest';

import {
  annualCost,
  monthlyCost,
  potentialAnnualSavings,
  savingsPercentage,
  total12MonthCost,
} from '@/lib/comparison/costs';
import {
  isFreshOffer,
  matchComparisonOffers,
  matchKind,
  offerFreshness,
  type ComparableOffer,
} from '@/lib/comparison/matching';

/**
 * Matching et coûts du comparateur
 * (`specs/comparateur-et-assistant-ia.md` A.3, A.4, A.6, checklist A.9).
 *
 * Ce module est pur : aucune base, aucun réseau, aucune IA.
 */
const NOW = new Date('2026-03-15T00:00:00.000Z');

function offer(overrides: Partial<ComparableOffer> = {}): ComparableOffer {
  return {
    id: 'off_1',
    serviceName: 'Netflix',
    country: 'FR',
    currency: 'EUR',
    verifiedPriceMinor: 1099n,
    billingCycle: 'MONTHLY',
    lastVerifiedAt: new Date('2026-03-01T00:00:00.000Z'),
    nextCheckAt: new Date('2026-04-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('matching déterministe (A.3)', () => {
  it('ne retient que les offres du même pays', () => {
    const matched = matchComparisonOffers(
      { merchantNormalized: 'Netflix', country: 'FR', currency: 'EUR', now: NOW },
      [offer({ id: 'fr' }), offer({ id: 'us', country: 'US' })],
    );

    expect(matched.map((entry) => entry.id)).toEqual(['fr']);
  });

  it('ne retient que les offres de la même devise', () => {
    const matched = matchComparisonOffers(
      { merchantNormalized: 'Netflix', country: 'FR', currency: 'EUR', now: NOW },
      [offer({ id: 'eur' }), offer({ id: 'usd', currency: 'USD' })],
    );

    expect(matched.map((entry) => entry.id)).toEqual(['eur']);
  });

  it('exclut une offre dont la prochaine vérification est dépassée', () => {
    const matched = matchComparisonOffers(
      { merchantNormalized: 'Netflix', country: 'FR', currency: 'EUR', now: NOW },
      [offer({ id: 'expiree', nextCheckAt: new Date('2026-03-01T00:00:00.000Z') })],
    );

    expect(matched).toHaveLength(0);
  });

  it('rapproche sur la clé normalisée : casse, accents et ponctuation neutralisés', () => {
    // Le commerçant arrive déjà normalisé par le pipeline d'import (§9) ; le
    // rapprochement ne tolère que les écarts de format, jamais de sémantique.
    expect(matchKind('netflix', 'Netflix')).toBe('EXACT');
    expect(matchKind('CANAL+', 'canal+')).toBe('EXACT');
    // Le « + » reste un caractère signifiant (Disney+, Canal+) : il n'est pas
    // assimilé à un séparateur.
    expect(matchKind('Déezer', 'Deezer')).toBe('EXACT');
    expect(matchKind('Netflix', 'Spotify')).toBeNull();
  });

  it('ne propose une correspondance approximative que comme suggestion', () => {
    // « Netflix » ↔ « Netflix Standard » : piste à vérifier, jamais confirmée.
    expect(matchKind('Netflix', 'Netflix Standard')).toBe('SUGGESTED');
    // Aucune similarité sémantique : deux noms distincts ne se rapprochent pas.
    expect(matchKind('Netflix', 'Standard Netflix')).toBeNull();
  });

  it('classe par prix croissant, sans jamais tenir compte de la commission', () => {
    const matched = matchComparisonOffers(
      { merchantNormalized: 'Netflix', country: 'FR', currency: 'EUR', now: NOW },
      [
        offer({ id: 'chere', verifiedPriceMinor: 1999n }),
        offer({ id: 'affiliee', verifiedPriceMinor: 1599n }),
        offer({ id: 'moins_chere', verifiedPriceMinor: 599n }),
      ],
    );

    expect(matched.map((entry) => entry.id)).toEqual(['moins_chere', 'affiliee', 'chere']);
  });

  it('produit exactement le même ordre à chaque exécution', () => {
    const offers = [
      offer({ id: 'b', verifiedPriceMinor: 1099n }),
      offer({ id: 'a', verifiedPriceMinor: 1099n }),
      offer({ id: 'c', verifiedPriceMinor: 999n }),
    ];

    const runs = Array.from({ length: 10 }, () =>
      matchComparisonOffers(
        { merchantNormalized: 'Netflix', country: 'FR', currency: 'EUR', now: NOW },
        offers,
      ).map((entry) => entry.id),
    );

    expect(new Set(runs.map((run) => run.join(',')))).toEqual(new Set(['c,a,b']));
  });
});

describe('fraîcheur des offres (A.6)', () => {
  it('considère fraîche une offre vérifiée dans la fenêtre', () => {
    expect(offerFreshness(offer(), NOW)).toBe('FRESH');
    expect(isFreshOffer(offer(), NOW)).toBe(true);
  });

  it('déclasse en obsolète une vérification plus ancienne que la fenêtre', () => {
    const tooOld = new Date(NOW.getTime() - (COMPARISON_OFFER_MAX_AGE_DAYS + 1) * 86_400_000);

    expect(offerFreshness(offer({ lastVerifiedAt: tooOld }), NOW)).toBe('STALE');
  });

  it('accepte exactement la limite de 30 jours', () => {
    const exactly = new Date(NOW.getTime() - COMPARISON_OFFER_MAX_AGE_DAYS * 86_400_000);

    expect(offerFreshness(offer({ lastVerifiedAt: exactly }), NOW)).toBe('FRESH');
  });

  it('marque expirée une offre dont la date de contrôle est passée', () => {
    expect(offerFreshness(offer({ nextCheckAt: new Date('2026-03-14T00:00:00.000Z') }), NOW)).toBe(
      'EXPIRED',
    );
  });
});

describe('coûts comparés (A.4)', () => {
  it('calcule le coût mensuel et annuel d’une formule mensuelle', () => {
    const price = money(1099n, 'EUR');

    expect(monthlyCost(price, 'MONTHLY')).toEqual(price);
    expect(annualCost(price, 'MONTHLY').amountMinor).toBe(13_188n);
  });

  it('calcule le coût mensuel et annuel d’une formule annuelle', () => {
    const price = money(11_988n, 'EUR');

    expect(monthlyCost(price, 'YEARLY')?.amountMinor).toBe(999n);
    expect(annualCost(price, 'YEARLY')).toEqual(price);
  });

  it('arrondit le mensuel d’une formule annuelle au centime le plus proche', () => {
    // 100,00 / 12 = 8,3333… → 8,33 (arrondi à mi-chemin vers l'infini).
    expect(monthlyCost(money(10_000n, 'EUR'), 'YEARLY')?.amountMinor).toBe(833n);
    // 10,00 / 12 = 0,8333… → 0,83
    expect(monthlyCost(money(1000n, 'EUR'), 'YEARLY')?.amountMinor).toBe(83n);
  });

  it('assimile le coût sur 12 mois au coût annuel', () => {
    const price = money(1599n, 'EUR');

    expect(total12MonthCost(price, 'MONTHLY')).toEqual(annualCost(price, 'MONTHLY'));
    expect(total12MonthCost(price, 'YEARLY')).toEqual(annualCost(price, 'YEARLY'));
  });

  it('est exact au centime sur 12 mois', () => {
    // 13,49 × 12 = 161,88 — jamais 161,87999999999998.
    expect(annualCost(money(1349n, 'EUR'), 'MONTHLY').amountMinor).toBe(16_188n);
  });

  it('ne produit jamais d’économie négative', () => {
    const current = money(10_000n, 'EUR');
    const plusCher = money(15_000n, 'EUR');

    expect(potentialAnnualSavings(current, plusCher)?.amountMinor).toBe(0n);
  });

  it('calcule l’économie et son pourcentage exact', () => {
    const current = money(16_188n, 'EUR');
    const alternative = money(9588n, 'EUR');
    const savings = potentialAnnualSavings(current, alternative);

    expect(savings?.amountMinor).toBe(6600n);
    // 6600 / 16188 = 40,7709… %
    expect(savings === null ? null : savingsPercentage(savings, current)).toBe('40.77');
  });

  it('refuse de comparer deux devises différentes', () => {
    expect(potentialAnnualSavings(money(1000n, 'EUR'), money(500n, 'USD'))).toBeNull();
  });

  it('renvoie null plutôt qu’un pourcentage infini quand le coût actuel est nul', () => {
    expect(savingsPercentage(money(0n, 'EUR'), money(0n, 'EUR'))).toBeNull();
  });
});
