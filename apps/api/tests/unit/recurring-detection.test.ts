import { describe, expect, it } from 'vitest';

import { computeConfidence, CONFIDENCE_POINTS } from '@/lib/recurring/confidence';
import { detectRecurrence, type RecurringDetectionInput } from '@/lib/recurring/detect';
import { classifyFrequency, RECURRENCE_WINDOWS } from '@/lib/recurring/frequency';
import { computeIntervals, daysBetween, medianInterval, spanDays } from '@/lib/recurring/interval';

/** `specs/moteur-recurrence.md` §3 à §7 et §10. */
function input(
  dates: readonly string[],
  amount: string | readonly string[] = '13.49',
  merchant = 'Netflix',
): RecurringDetectionInput {
  return {
    merchantNormalized: merchant,
    currency: 'EUR',
    transactions: dates.map((date, index) => ({
      id: `exp_${String(index + 1)}`,
      date,
      amount: typeof amount === 'string' ? amount : (amount[index] ?? '13.49'),
    })),
  };
}

describe('calcul des intervalles', () => {
  it('compte les jours calendaires entre deux dates', () => {
    expect(daysBetween('2026-01-05', '2026-02-05')).toBe(31);
    expect(daysBetween('2026-02-05', '2026-03-05')).toBe(28);
    // 2024 est bissextile : février compte 29 jours.
    expect(daysBetween('2024-02-05', '2024-03-05')).toBe(29);
  });

  it('ne dépend pas de l’ordre des dates fournies', () => {
    const desordre = computeIntervals(['2026-03-05', '2026-01-05', '2026-02-05']);
    const ordre = computeIntervals(['2026-01-05', '2026-02-05', '2026-03-05']);

    expect(desordre).toEqual(ordre);
  });

  it('calcule la médiane et l’étendue', () => {
    expect(medianInterval([30, 31, 29])).toBe(30);
    expect(medianInterval([28, 30, 31, 33])).toBe(30);
    expect(medianInterval([])).toBeNull();
    expect(spanDays(['2026-01-05', '2026-04-05'])).toBe(90);
  });
});

describe('classification des périodicités', () => {
  it('expose une définition unique des fenêtres', () => {
    expect(RECURRENCE_WINDOWS.MONTHLY).toEqual({ targetDays: 30, toleranceDays: 5 });
    expect(RECURRENCE_WINDOWS.WEEKLY).toEqual({ targetDays: 7, toleranceDays: 2 });
    expect(RECURRENCE_WINDOWS.QUARTERLY).toEqual({ targetDays: 91, toleranceDays: 10 });
    expect(RECURRENCE_WINDOWS.YEARLY).toEqual({ targetDays: 365, toleranceDays: 20 });
  });

  it('retient une périodicité dès qu’une majorité d’intervalles y tombe', () => {
    // 2 intervalles mensuels sur 3 : la majorité suffit, l'écart isolé est toléré.
    expect(classifyFrequency([30, 31, 12], 73, 4).frequency).toBe('MONTHLY');
  });

  it('ne retient rien sans majorité', () => {
    expect(classifyFrequency([7, 30, 91], 128, 4).frequency).not.toBe('MONTHLY');
  });
});

describe('détection des récurrences', () => {
  it('reconnaît 3 paiements mensuels réguliers', () => {
    const result = detectRecurrence(input(['2026-01-05', '2026-02-05', '2026-03-05']));

    expect(result.isRecurring).toBe(true);
    expect(result.frequency).toBe('MONTHLY');
    expect(result.occurrences).toBe(3);
    // Médiane de [31, 28] jours (janvier→février, février→mars), arrondie à
    // l'entier inférieur : la règle est fixe, donc reproductible.
    expect(result.intervalDays).toBe(29);
  });

  it('reconnaît 4 paiements hebdomadaires', () => {
    const result = detectRecurrence(
      input(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']),
    );

    expect(result.frequency).toBe('WEEKLY');
    expect(result.intervalDays).toBe(7);
  });

  it('reconnaît des paiements trimestriels', () => {
    const result = detectRecurrence(input(['2026-01-05', '2026-04-05', '2026-07-05']));

    expect(result.frequency).toBe('QUARTERLY');
  });

  it('reconnaît des paiements annuels, année bissextile comprise', () => {
    const result = detectRecurrence(input(['2023-03-01', '2024-03-01', '2025-03-01']));

    // 2024 est bissextile : l'un des intervalles vaut 366 jours.
    expect(computeIntervals(['2023-03-01', '2024-03-01', '2025-03-01'])).toEqual([366, 365]);
    expect(result.frequency).toBe('YEARLY');
  });

  it('reconnaît un historique irrégulier mais suffisamment récurrent', () => {
    const result = detectRecurrence(
      input(['2026-01-05', '2026-02-01', '2026-03-15', '2026-04-10', '2026-05-20']),
    );

    expect(result.frequency).toBe('IRREGULAR_RECURRING');
    expect(result.isRecurring).toBe(true);
  });

  it('reste conservateur : un historique court et clairsemé n’est pas récurrent', () => {
    const result = detectRecurrence(input(['2026-01-05', '2026-01-20', '2026-02-28']));

    expect(result.isRecurring).toBe(false);
    expect(result.frequency).toBeNull();
  });

  it('ne considère jamais une seule transaction comme récurrente', () => {
    const result = detectRecurrence(input(['2026-01-05']));

    expect(result.isRecurring).toBe(false);
    expect(result.frequency).toBeNull();
    expect(result.occurrences).toBe(1);
  });

  it('juge deux transactions insuffisantes pour une détection standard', () => {
    const result = detectRecurrence(input(['2026-01-05', '2026-02-05']));

    expect(result.isRecurring).toBe(false);
    expect(result.occurrences).toBe(2);
  });

  it('ne dépend pas de l’ordre des transactions en entrée', () => {
    const ordre = detectRecurrence(input(['2026-01-05', '2026-02-05', '2026-03-05']));
    const desordre = detectRecurrence(input(['2026-03-05', '2026-01-05', '2026-02-05']));

    expect(desordre).toEqual({ ...ordre, occurrences: ordre.occurrences });
  });

  it('calcule la variance des montants en décimal exact', () => {
    const result = detectRecurrence(
      input(['2026-01-05', '2026-02-05', '2026-03-05'], ['9.99', '10.99', '11.99']),
    );

    expect(result.amountVariance).toBe('2.00');
  });

  it('refuse une devise hors référentiel plutôt que de comparer des montants', () => {
    const result = detectRecurrence({
      merchantNormalized: 'Netflix',
      currency: 'CHF',
      transactions: [
        { id: '1', date: '2026-01-05', amount: '13.49' },
        { id: '2', date: '2026-02-05', amount: '13.49' },
        { id: '3', date: '2026-03-05', amount: '13.49' },
      ],
    });

    expect(result.isRecurring).toBe(false);
  });
});

describe('score de confiance', () => {
  const dates = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05', '2026-05-05'];

  it('attribue HIGH à une série mensuelle stable et longue', () => {
    const result = detectRecurrence(input(dates));

    // 30 (commerçant) + 25 (périodique) + 20 (≥ 5) + 15 (montant stable) + 10 (≥ 90 j)
    expect(result.confidenceScore).toBe(100);
    expect(result.confidence).toBe('HIGH');
  });

  it('réduit la confiance quand les montants varient fortement', () => {
    const stable = detectRecurrence(input(dates));
    const variable = detectRecurrence(input(dates, ['10.00', '10.00', '10.00', '10.00', '40.00']));

    expect(variable.confidenceScore).toBe(
      stable.confidenceScore - CONFIDENCE_POINTS.lowAmountVariance,
    );
  });

  it('fait basculer le niveau quand la variation s’ajoute à un historique court', () => {
    const courts = ['2026-01-05', '2026-02-05', '2026-03-05'];
    const stable = detectRecurrence(input(courts));
    const variable = detectRecurrence(input(courts, ['10.00', '10.00', '40.00']));

    expect(stable.confidence).toBe('MEDIUM');
    expect(variable.confidence).toBe('LOW');
    expect(variable.confidenceScore).toBe(55);
  });

  it('réduit la confiance sur un historique court et peu fourni', () => {
    const result = detectRecurrence(input(['2026-01-05', '2026-02-05', '2026-03-05']));

    // 30 + 25 + 15 : ni 5 occurrences, ni 90 jours d'historique.
    expect(result.confidenceScore).toBe(70);
    expect(result.confidence).toBe('MEDIUM');
  });

  it('n’accorde pas le critère « commerçant stable » à un libellé non identifiant', () => {
    const identifiable = detectRecurrence(input(dates, '13.49', 'Netflix'));
    const anonyme = detectRecurrence(input(dates, '13.49', '4972830183'));

    expect(anonyme.confidenceScore).toBe(
      identifiable.confidenceScore - CONFIDENCE_POINTS.stableMerchant,
    );
  });

  it('plafonne une récurrence irrégulière sous le niveau HIGH', () => {
    const result = detectRecurrence(
      input(['2026-01-05', '2026-02-01', '2026-03-15', '2026-04-10', '2026-05-20']),
    );

    expect(result.confidence).not.toBe('HIGH');
    expect(result.confidenceScore).toBeLessThan(80);
  });

  it('applique la grille de points telle qu’elle est définie', () => {
    expect(
      computeConfidence({
        stableMerchant: true,
        periodicInterval: true,
        occurrences: 5,
        lowAmountVariance: true,
        spanDays: 90,
      }),
    ).toEqual({ score: 100, level: 'HIGH' });

    expect(
      computeConfidence({
        stableMerchant: true,
        periodicInterval: true,
        occurrences: 3,
        lowAmountVariance: true,
        spanDays: 60,
      }),
    ).toEqual({ score: 70, level: 'MEDIUM' });

    expect(
      computeConfidence({
        stableMerchant: false,
        periodicInterval: true,
        occurrences: 3,
        lowAmountVariance: false,
        spanDays: 10,
      }),
    ).toEqual({ score: 25, level: 'LOW' });
  });
});

describe('déterminisme', () => {
  it('produit exactement le même résultat sur plusieurs exécutions', () => {
    const fixture = input(
      ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05'],
      ['9.99', '9.99', '11.99', '11.99'],
    );

    const executions = Array.from({ length: 25 }, () => detectRecurrence(fixture));
    const reference = JSON.stringify(executions[0]);

    for (const execution of executions) {
      expect(JSON.stringify(execution)).toBe(reference);
    }
  });

  it('ne mute jamais son entrée', () => {
    const fixture = input(['2026-03-05', '2026-01-05', '2026-02-05']);
    const copie = structuredClone(fixture);

    detectRecurrence(fixture);

    expect(fixture).toEqual(copie);
  });
});
