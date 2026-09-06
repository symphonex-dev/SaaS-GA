import { describe, expect, it } from 'vitest';

import {
  detectPriceChange,
  formatPercentageChange,
  relativeVarianceAtMost,
  computeAmountStatistics,
  parseAmounts,
  type AmountObservation,
} from '@/lib/recurring/amount';
import { detectRecurrence } from '@/lib/recurring/detect';

/** `specs/moteur-recurrence.md` §5 et §10. */
function series(amounts: readonly string[]): AmountObservation[] {
  const parsed = parseAmounts(amounts, 'EUR') ?? [];

  return parsed.map((amountMinorUnits, index) => ({
    // Un paiement mensuel : les dates n'influent pas sur la détection de hausse,
    // mais restent réalistes pour les assertions sur `detectedAt`.
    date: `2026-0${String(index + 1)}-05`,
    amountMinorUnits,
  }));
}

describe('détection des hausses de prix', () => {
  it('ne signale aucune hausse quand le montant ne change pas', () => {
    expect(detectPriceChange(series(['9.99', '9.99', '9.99']), 'EUR')).toBeNull();
  });

  it('confirme une hausse tenue sur deux occurrences consécutives', () => {
    const change = detectPriceChange(series(['9.99', '9.99', '11.99', '11.99']), 'EUR');

    expect(change).toMatchObject({
      previousAmount: '9.99',
      currentAmount: '11.99',
      absoluteChange: '2.00',
      confirmed: true,
    });
    expect(change?.detectedAt).toBe('2026-03-05');
  });

  it('ne confirme pas une variation ponctuelle revenue à l’ancien montant', () => {
    const change = detectPriceChange(series(['9.99', '12.99', '9.99']), 'EUR');

    expect(change?.confirmed).toBe(false);
  });

  it('ne confirme pas une hausse observée sur une seule occurrence', () => {
    const change = detectPriceChange(series(['9.99', '9.99', '11.99']), 'EUR');

    expect(change).toMatchObject({ currentAmount: '11.99', confirmed: false });
  });

  it('décrit aussi une baisse, avec un montant négatif', () => {
    const change = detectPriceChange(series(['12.99', '12.99', '9.99', '9.99']), 'EUR');

    expect(change).toMatchObject({
      previousAmount: '12.99',
      currentAmount: '9.99',
      absoluteChange: '-3.00',
      confirmed: true,
    });
    expect(change?.percentageChange.startsWith('-')).toBe(true);
  });

  it('ne signale rien avec moins de deux occurrences', () => {
    expect(detectPriceChange(series(['9.99']), 'EUR')).toBeNull();
    expect(detectPriceChange([], 'EUR')).toBeNull();
  });
});

describe('calcul du pourcentage de variation', () => {
  it('calcule un pourcentage exact à deux décimales', () => {
    // 2,00 € sur 9,99 € = 20,02 %
    expect(formatPercentageChange(999n, 200n)).toBe('20.02');
    // 5,00 € sur 10,00 € = 50 %
    expect(formatPercentageChange(1000n, 500n)).toBe('50.00');
    // Doublement du prix.
    expect(formatPercentageChange(1000n, 1000n)).toBe('100.00');
  });

  it('gère les baisses', () => {
    expect(formatPercentageChange(1299n, -300n)).toBe('-23.09');
  });

  it('ne divise jamais par zéro', () => {
    expect(formatPercentageChange(0n, 500n)).toBe('0.00');
    expect(formatPercentageChange(0n, 0n)).toBe('0.00');
  });

  it('reste juste sur de petites variations', () => {
    // 0,01 € sur 9,99 € = 0,10 %
    expect(formatPercentageChange(999n, 1n)).toBe('0.10');
  });
});

describe('variation relative des montants', () => {
  it('compare sans jamais diviser', () => {
    const stable = computeAmountStatistics(parseAmounts(['10.00', '10.00', '10.20'], 'EUR') ?? []);
    const variable = computeAmountStatistics(
      parseAmounts(['10.00', '10.00', '40.00'], 'EUR') ?? [],
    );

    expect(stable).not.toBeNull();
    expect(variable).not.toBeNull();
    expect(relativeVarianceAtMost(stable as never, 5)).toBe(true);
    expect(relativeVarianceAtMost(variable as never, 5)).toBe(false);
  });

  it('traite une somme nulle comme une absence de variation', () => {
    const statistics = computeAmountStatistics([0n, 0n, 0n]);

    expect(relativeVarianceAtMost(statistics as never, 5)).toBe(true);
  });
});

describe('intégration au moteur', () => {
  it('expose la hausse confirmée dans le résultat de détection', () => {
    const result = detectRecurrence({
      merchantNormalized: 'Netflix',
      currency: 'EUR',
      transactions: [
        { id: '1', date: '2026-01-05', amount: '9.99' },
        { id: '2', date: '2026-02-05', amount: '9.99' },
        { id: '3', date: '2026-03-05', amount: '11.99' },
        { id: '4', date: '2026-04-05', amount: '11.99' },
      ],
    });

    expect(result.frequency).toBe('MONTHLY');
    expect(result.priceChange).toMatchObject({
      previousAmount: '9.99',
      currentAmount: '11.99',
      percentageChange: '20.02',
      confirmed: true,
    });
    expect(result.amountVariance).toBe('2.00');
  });

  it('expose la variation même quand la série n’est pas récurrente', () => {
    const result = detectRecurrence({
      merchantNormalized: 'Netflix',
      currency: 'EUR',
      transactions: [
        { id: '1', date: '2026-01-05', amount: '9.99' },
        { id: '2', date: '2026-02-05', amount: '11.99' },
      ],
    });

    expect(result.isRecurring).toBe(false);
    expect(result.priceChange?.confirmed).toBe(false);
    expect(result.amountVariance).toBe('2.00');
  });
});
