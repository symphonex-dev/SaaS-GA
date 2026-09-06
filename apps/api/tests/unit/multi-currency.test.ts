import {
  addMoney,
  CurrencyMismatchError,
  SUPPORTED_CURRENCIES,
  averageMoney,
  fromMinorUnits,
  moneyFromDecimal,
  parseMinorUnits,
  potentialSavingsBetween,
  sumMoney,
  toMinorUnits,
  type Currency,
  type Money,
} from '@subscription-manager/shared';
import { describe, expect, it } from 'vitest';

import {
  ExchangeRateUnavailableError,
  noConversionProvider,
  partitionByCurrency,
  resolveCurrency,
} from '@/lib/finance/currency';
import { totalForPeriod, type FinanceLine } from '@/lib/finance/totals';

/** `specs/calculs-financiers.md` §7 et §9. */
const PERIOD = { from: '2026-01-01', to: '2026-01-31' };

function amount(decimal: string, currency: Currency): Money {
  const value = moneyFromDecimal(decimal, currency);

  if (value === null) {
    throw new Error(`Montant de test invalide : ${decimal} ${currency}`);
  }

  return value;
}

describe('devises supportées', () => {
  it('couvre exactement les cinq devises de la V1', () => {
    expect([...SUPPORTED_CURRENCIES]).toEqual(['EUR', 'USD', 'GBP', 'CAD', 'AUD']);
  });

  it.each([...SUPPORTED_CURRENCIES])('convertit sans perte en %s', (currency) => {
    const minorUnits = toMinorUnits('1234.56', currency);

    expect(minorUnits).toBe(123_456n);
    expect(fromMinorUnits(minorUnits, currency)).toBe('1234.56');
  });

  it.each([...SUPPORTED_CURRENCIES])('additionne en %s sans passer par un flottant', (currency) => {
    const total = addMoney(amount('0.10', currency), amount('0.20', currency));

    expect(total.amountMinor).toBe(30n);
    expect(total.currency).toBe(currency);
    expect(typeof total.amountMinor).toBe('bigint');
  });

  it('rejette une devise inconnue', () => {
    expect(parseMinorUnits('10.00', 'CHF')).toBeNull();
    expect(parseMinorUnits('10.00', 'BTC')).toBeNull();
    expect(() => toMinorUnits('10.00', 'CHF')).toThrow();
    expect(() => fromMinorUnits(1000n, 'CHF')).toThrow();
  });

  it('retombe sur EUR si la devise stockée est corrompue', () => {
    expect(resolveCurrency('USD')).toBe('USD');
    expect(resolveCurrency('CHF')).toBe('EUR');
    expect(resolveCurrency('')).toBe('EUR');
  });
});

describe('interdiction des additions inter-devises', () => {
  it('refuse 100 USD + 100 EUR', () => {
    expect(() => addMoney(amount('100.00', 'USD'), amount('100.00', 'EUR'))).toThrow(
      CurrencyMismatchError,
    );
  });

  it('refuse une somme dont un élément est dans une autre devise', () => {
    expect(() => sumMoney([amount('10.00', 'EUR'), amount('10.00', 'GBP')], 'EUR')).toThrow(
      CurrencyMismatchError,
    );
  });

  it('refuse une moyenne multi-devises plutôt que de la calculer', () => {
    expect(averageMoney([amount('10.00', 'EUR'), amount('10.00', 'USD')])).toBeNull();
  });

  it('refuse une économie entre deux devises différentes', () => {
    expect(potentialSavingsBetween(amount('120.00', 'EUR'), amount('90.00', 'USD'))).toBeNull();
  });

  it('écarte silencieusement mais sans jamais convertir dans un total', () => {
    const lines: FinanceLine[] = [
      {
        id: '1',
        date: '2026-01-05',
        amount: amount('100.00', 'EUR'),
        category: 'OTHER',
        status: 'ACTIVE',
      },
      {
        id: '2',
        date: '2026-01-06',
        amount: amount('100.00', 'USD'),
        category: 'OTHER',
        status: 'ACTIVE',
      },
    ];

    // 100 EUR + 100 USD ne vaut jamais 200 : seule la devise cible est totalisée.
    expect(totalForPeriod({ lines, period: PERIOD, currency: 'EUR' }).amountMinor).toBe(10_000n);
    expect(totalForPeriod({ lines, period: PERIOD, currency: 'USD' }).amountMinor).toBe(10_000n);
  });

  it('sépare les lignes par devise pour pouvoir les signaler', () => {
    const lines = [
      { currency: 'EUR' },
      { currency: 'USD' },
      { currency: 'USD' },
      { currency: 'GBP' },
    ];

    const { inTarget, others } = partitionByCurrency(lines, (line) => line.currency, 'EUR');

    expect(inTarget).toHaveLength(1);
    expect(others.get('USD')).toHaveLength(2);
    expect(others.get('GBP')).toHaveLength(1);
  });
});

describe('fournisseur de taux de change', () => {
  it('refuse toute conversion en V1 plutôt que d’inventer un taux', async () => {
    await expect(noConversionProvider.getRate('USD', 'EUR', '2026-01-05')).rejects.toBeInstanceOf(
      ExchangeRateUnavailableError,
    );
  });

  it('n’expose aucun taux par défaut', () => {
    // Aucune constante de taux ne doit exister dans le moteur : le seul chemin
    // de conversion passe par un fournisseur explicite (§7).
    expect(Object.keys(noConversionProvider)).toEqual(['getRate']);
  });
});

describe('exactitude par devise', () => {
  it('ne perd jamais un centime, quelle que soit la devise', () => {
    for (const currency of SUPPORTED_CURRENCIES) {
      const lines = Array.from({ length: 333 }, () => amount('0.03', currency));
      const total = sumMoney(lines, currency);

      expect(fromMinorUnits(total.amountMinor, currency)).toBe('9.99');
    }
  });
});
