import {
  addMoney,
  annualizeIrregular,
  annualizeRecurring,
  ANNUALIZATION_FACTORS,
  calculatePotentialSavings,
  computeGoalProgress,
  computePeriodChange,
  divideMoney,
  fromMinorUnits,
  moneyFromDecimal,
  multiplyMoney,
  subtractMoney,
  sumMoney,
  toMinorUnits,
  type Money,
} from '@subscription-manager/shared';
import { describe, expect, it } from 'vitest';

import { averageMonthlyCost, averageOfLines } from '@/lib/finance/averages';
import { comparePeriods } from '@/lib/finance/comparisons';
import { addMonthsPreservingDay, nextExpectedDate } from '@/lib/finance/projections';
import { annualSavingAgainstOffer, confirmedFromGoals } from '@/lib/finance/savings';
import {
  totalByCategory,
  totalForPeriod,
  totalSubscriptions,
  type FinanceLine,
} from '@/lib/finance/totals';

/** `specs/calculs-financiers.md` §1 à §6 et §9. */
function eur(decimal: string): Money {
  const value = moneyFromDecimal(decimal, 'EUR');

  if (value === null) {
    throw new Error(`Montant de test invalide : ${decimal}`);
  }

  return value;
}

function line(
  overrides: Partial<FinanceLine> & { id: string; date: string; amount: Money },
): FinanceLine {
  return {
    category: 'OTHER',
    status: 'ACTIVE',
    ...overrides,
  };
}

const JANUARY = { from: '2026-01-01', to: '2026-01-31' };
const FEBRUARY = { from: '2026-02-01', to: '2026-02-28' };

describe('représentation exacte de l’argent', () => {
  it('additionne 0,10 + 0,20 = 0,30 exactement', () => {
    const total = addMoney(eur('0.10'), eur('0.20'));

    expect(total.amountMinor).toBe(30n);
    expect(fromMinorUnits(total.amountMinor, 'EUR')).toBe('0.30');
    // Le piège classique du flottant : 0.1 + 0.2 !== 0.3 en `number`.
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('convertit dans les deux sens sans perte', () => {
    for (const value of ['0.01', '13.49', '999999.99', '123456789.01']) {
      expect(fromMinorUnits(toMinorUnits(value, 'EUR'), 'EUR')).toBe(value);
    }
  });

  it('refuse un montant plus précis que la devise', () => {
    expect(() => toMinorUnits('13.499', 'EUR')).toThrow();
    expect(moneyFromDecimal('13.499', 'EUR')).toBeNull();
    // Un chiffre non nul en trop est refusé même très loin derrière la virgule.
    expect(moneyFromDecimal('13.4900001', 'EUR')).toBeNull();
  });

  it("accepte les zéros de remplissage de l'échelle de stockage", () => {
    // `Decimal(19, 4)` représente 13,49 € par « 13.4900 » : ces zéros ne
    // changent rien à la valeur et ne doivent pas faire échouer la relecture.
    expect(toMinorUnits('13.4900', 'EUR')).toBe(1349n);
    expect(moneyFromDecimal('0.0000', 'EUR')?.amountMinor).toBe(0n);
    expect(moneyFromDecimal('-7.5000', 'EUR')?.amountMinor).toBe(-750n);
  });

  it('somme mille lignes sans dérive', () => {
    const lines = Array.from({ length: 1000 }, () => eur('0.01'));

    expect(fromMinorUnits(sumMoney(lines, 'EUR').amountMinor, 'EUR')).toBe('10.00');
  });

  it('multiplie et divise par un facteur décimal exact', () => {
    expect(multiplyMoney(eur('10.00'), '1.5')?.amountMinor).toBe(1500n);
    expect(multiplyMoney(eur('9.99'), '3')?.amountMinor).toBe(2997n);
    expect(divideMoney(eur('10.00'), '3')?.amountMinor).toBe(333n);
  });

  it('renvoie null pour une division par zéro, jamais zéro', () => {
    expect(divideMoney(eur('10.00'), '0')).toBeNull();
  });

  it('refuse d’additionner deux devises différentes', () => {
    const usd = moneyFromDecimal('10.00', 'USD');

    expect(usd).not.toBeNull();
    expect(() => addMoney(eur('10.00'), usd as Money)).toThrow();
  });
});

describe('totaux', () => {
  const lines: FinanceLine[] = [
    line({ id: '1', date: '2026-01-05', amount: eur('13.49'), category: 'STREAMING' }),
    line({ id: '2', date: '2026-01-12', amount: eur('11.99'), category: 'MUSIC' }),
    line({ id: '3', date: '2026-01-20', amount: eur('4.50'), category: 'FOOD' }),
    line({ id: '4', date: '2026-02-05', amount: eur('13.49'), category: 'STREAMING' }),
  ];

  it('calcule le total mensuel de la période demandée', () => {
    expect(totalForPeriod({ lines, period: JANUARY, currency: 'EUR' }).amountMinor).toBe(2998n);
    expect(totalForPeriod({ lines, period: FEBRUARY, currency: 'EUR' }).amountMinor).toBe(1349n);
  });

  it('calcule un total annuel sur une année civile explicite', () => {
    const total = totalForPeriod({
      lines,
      period: { from: '2026-01-01', to: '2026-12-31' },
      currency: 'EUR',
    });

    expect(total.amountMinor).toBe(4347n);
  });

  it('exclut les dépenses annulées', () => {
    const withCancelled = [
      ...lines,
      line({ id: '5', date: '2026-01-25', amount: eur('99.00'), status: 'CANCELLED' }),
    ];

    expect(
      totalForPeriod({ lines: withCancelled, period: JANUARY, currency: 'EUR' }).amountMinor,
    ).toBe(2998n);
  });

  it('exclut une ligne à vérifier', () => {
    const withReview = [
      ...lines,
      line({ id: '6', date: '2026-01-25', amount: eur('50.00'), status: 'TO_REVIEW' }),
    ];

    expect(
      totalForPeriod({ lines: withReview, period: JANUARY, currency: 'EUR' }).amountMinor,
    ).toBe(2998n);
  });

  it('déduit les remboursements applicables à la période', () => {
    const total = totalForPeriod({
      lines,
      refunds: [{ id: 'r1', date: '2026-01-18', amount: eur('4.50') }],
      period: JANUARY,
      currency: 'EUR',
    });

    expect(total.amountMinor).toBe(2548n);
  });

  it('ignore un remboursement hors période', () => {
    const total = totalForPeriod({
      lines,
      refunds: [{ id: 'r1', date: '2026-03-18', amount: eur('4.50') }],
      period: JANUARY,
      currency: 'EUR',
    });

    expect(total.amountMinor).toBe(2998n);
  });

  it('n’additionne jamais une dépense d’une autre devise', () => {
    const usd = moneyFromDecimal('100.00', 'USD') as Money;
    const mixed = [...lines, line({ id: '7', date: '2026-01-15', amount: usd })];

    expect(totalForPeriod({ lines: mixed, period: JANUARY, currency: 'EUR' }).amountMinor).toBe(
      2998n,
    );
  });

  it('répartit les totaux par catégorie avec un pourcentage exact', () => {
    const categories = totalByCategory({ lines, period: JANUARY, currency: 'EUR' });

    // 13,49 / 29,98 = 44,9966 % → arrondi au centième le plus proche.
    expect(categories[0]).toMatchObject({ category: 'STREAMING', percentage: '45.00' });
    expect(categories.map((entry) => entry.category)).toEqual(['STREAMING', 'MUSIC', 'FOOD']);
    expect(categories.reduce((sum, entry) => sum + entry.amount.amountMinor, 0n)).toBe(2998n);
  });

  it('ne totalise que les dépenses rattachées à une récurrence', () => {
    const recurring = new Set(['1', '2']);

    expect(totalSubscriptions(lines, recurring, 'EUR').amountMinor).toBe(2548n);
    expect(totalSubscriptions(lines, new Set(), 'EUR').amountMinor).toBe(0n);
  });
});

describe('moyennes et annualisation', () => {
  it('applique les facteurs d’annualisation de la spec', () => {
    expect(ANNUALIZATION_FACTORS).toEqual({ WEEKLY: 52n, MONTHLY: 12n, QUARTERLY: 4n, YEARLY: 1n });
    expect(annualizeRecurring(eur('10.00'), 'MONTHLY')?.amountMinor).toBe(12_000n);
    expect(annualizeRecurring(eur('10.00'), 'WEEKLY')?.amountMinor).toBe(52_000n);
    expect(annualizeRecurring(eur('10.00'), 'QUARTERLY')?.amountMinor).toBe(4_000n);
    expect(annualizeRecurring(eur('10.00'), 'YEARLY')?.amountMinor).toBe(1_000n);
  });

  it('n’annualise ni ONCE ni une série irrégulière par un facteur fixe', () => {
    expect(annualizeRecurring(eur('10.00'), 'ONCE')).toBeNull();
    expect(annualizeRecurring(eur('10.00'), 'IRREGULAR_RECURRING')).toBeNull();
  });

  it('extrapole une série irrégulière seulement si l’historique le permet', () => {
    expect(annualizeIrregular(eur('100.00'), 180, 6)?.amountMinor).toBe(20_278n);
    // Historique trop court ou trop clairsemé : null, jamais une fausse précision.
    expect(annualizeIrregular(eur('100.00'), 30, 6)).toBeNull();
    expect(annualizeIrregular(eur('100.00'), 180, 2)).toBeNull();
  });

  it('calcule un coût mensuel moyen à partir du coût annuel', () => {
    expect(averageMonthlyCost(eur('120.00'))?.amountMinor).toBe(1_000n);
  });

  it('calcule un coût moyen et renvoie null sur une série vide', () => {
    const lines = [
      line({ id: '1', date: '2026-01-05', amount: eur('10.00') }),
      line({ id: '2', date: '2026-02-05', amount: eur('20.00') }),
    ];

    expect(averageOfLines(lines)?.amountMinor).toBe(1_500n);
    expect(averageOfLines([])).toBeNull();
  });
});

describe('variation période sur période', () => {
  it('calcule la variation absolue et le pourcentage exact', () => {
    const change = computePeriodChange(eur('120.00'), eur('100.00'));

    expect(change.absoluteChange.amountMinor).toBe(2_000n);
    expect(change.percentageChange).toBe('20.00');
    expect(change.direction).toBe('UP');
  });

  it('gère une baisse', () => {
    const change = computePeriodChange(eur('90.00'), eur('120.00'));

    expect(change.percentageChange).toBe('-25.00');
    expect(change.direction).toBe('DOWN');
  });

  it('ne renvoie jamais Infinity quand la période précédente est nulle', () => {
    const change = computePeriodChange(eur('120.00'), eur('0.00'));

    expect(change.percentageChange).toBeNull();
    expect(change.direction).toBe('UP');
    expect(change.absoluteChange.amountMinor).toBe(12_000n);
  });

  it('signale une période inchangée', () => {
    expect(computePeriodChange(eur('100.00'), eur('100.00')).direction).toBe('UNCHANGED');
  });

  it('compare deux périodes à partir des lignes', () => {
    const lines = [
      line({ id: '1', date: '2026-01-10', amount: eur('100.00') }),
      line({ id: '2', date: '2026-02-10', amount: eur('120.00') }),
    ];

    const change = comparePeriods({ lines, current: FEBRUARY, previous: JANUARY, currency: 'EUR' });

    expect(change.percentageChange).toBe('20.00');
  });
});

describe('économies', () => {
  it('ne produit jamais une économie négative', () => {
    expect(calculatePotentialSavings(12_000n, 9_000n)).toBe(3_000n);
    expect(calculatePotentialSavings(9_000n, 12_000n)).toBe(0n);
    expect(annualSavingAgainstOffer(eur('120.00'), eur('150.00'))?.amountMinor).toBe(0n);
  });

  it('distingue potentiel et confirmé', () => {
    const confirmed = confirmedFromGoals(
      [{ targetAmount: eur('500.00'), achievedAmount: eur('120.00') }],
      'EUR',
    );

    expect(confirmed.amountMinor).toBe(12_000n);
  });

  it('borne la progression d’un objectif et évite la division par zéro', () => {
    expect(computeGoalProgress(eur('500.00'), eur('125.00')).progressPercentage).toBe('25.00');
    expect(computeGoalProgress(eur('100.00'), eur('250.00')).progressPercentage).toBe('100.00');
    expect(computeGoalProgress(eur('0.00'), eur('50.00')).progressPercentage).toBeNull();
    expect(computeGoalProgress(null, eur('50.00')).progressPercentage).toBeNull();
  });
});

describe('projections de dates', () => {
  it('préserve le jour du mois et ne produit jamais de date invalide', () => {
    expect(addMonthsPreservingDay('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsPreservingDay('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonthsPreservingDay('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonthsPreservingDay('2026-12-31', 1)).toBe('2027-01-31');
  });

  it('projette la prochaine échéance selon la périodicité', () => {
    expect(nextExpectedDate('2026-01-05', 'MONTHLY', 30)).toBe('2026-02-05');
    expect(nextExpectedDate('2026-01-05', 'WEEKLY', 7)).toBe('2026-01-12');
    expect(nextExpectedDate('2026-01-05', 'QUARTERLY', 91)).toBe('2026-04-05');
    expect(nextExpectedDate('2026-01-05', 'YEARLY', 365)).toBe('2027-01-05');
    expect(nextExpectedDate('2026-01-05', 'IRREGULAR_RECURRING', 40)).toBe('2026-02-14');
  });

  it('n’annonce aucune échéance quand aucune prévision n’est défendable', () => {
    expect(nextExpectedDate('2026-01-05', 'ONCE', null)).toBeNull();
    expect(nextExpectedDate('2026-01-05', 'IRREGULAR_RECURRING', null)).toBeNull();
  });
});

describe('soustraction', () => {
  it('reste exacte', () => {
    expect(subtractMoney(eur('100.00'), eur('33.33')).amountMinor).toBe(6_667n);
  });
});
