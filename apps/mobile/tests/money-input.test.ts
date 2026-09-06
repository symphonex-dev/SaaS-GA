import { describe, expect, it } from 'vitest';

import {
  isExpenseFormValid,
  validateExpenseForm,
  type ExpenseFormValues,
} from '../lib/expense-input';
import {
  dateTimeToIsoDate,
  isoDateToDateTime,
  minorUnitsToInputValue,
  parseAmountToMinorUnits,
} from '../lib/money-input';

/**
 * Transcription des montants saisis (mission §8 et §22).
 *
 * Règle CLAUDE.md §5.2 : jamais d'arithmétique flottante sur un montant.
 * `parseFloat('13.49') * 100` vaut 1348.9999… — ces tests figent le fait que
 * la transcription passe exclusivement par des chaînes.
 */
describe('saisie → unités mineures', () => {
  it.each([
    ['13.49', '1349'],
    ['13,49', '1349'],
    ['0.01', '1'],
    ['0,05', '5'],
    ['9', '900'],
    ['9.5', '950'],
    [' 12.30 ', '1230'],
    ['1 234,56', '123456'],
  ])('« %s » → %s', (input, expected) => {
    expect(parseAmountToMinorUnits(input, 'EUR')).toEqual({ minorUnits: expected });
  });

  it('reste exact là où un flottant se tromperait', () => {
    // 13.49 * 100 === 1348.9999999999998 en IEEE 754.
    expect(parseAmountToMinorUnits('13.49', 'EUR')?.minorUnits).toBe('1349');
    expect(parseAmountToMinorUnits('70.07', 'EUR')?.minorUnits).toBe('7007');
    expect(parseAmountToMinorUnits('1.005', 'EUR')).toBeNull();
  });

  it.each([['0'], ['0.00'], ['-5'], [''], ['abc'], ['1.234'], ['12.3.4'], ['1e3']])(
    'refuse « %s »',
    (input) => {
      expect(parseAmountToMinorUnits(input, 'EUR')).toBeNull();
    },
  );

  it('n’arrondit jamais une saisie trop précise en silence', () => {
    expect(parseAmountToMinorUnits('13.499', 'EUR')).toBeNull();
  });

  it('fait l’aller-retour sans perte', () => {
    for (const value of ['1349', '1', '100000', '5']) {
      const input = minorUnitsToInputValue(value, 'EUR');

      expect(parseAmountToMinorUnits(input, 'EUR')).toEqual({ minorUnits: value });
    }
  });

  it('rend une valeur d’édition lisible', () => {
    expect(minorUnitsToInputValue('1349', 'EUR')).toBe('13.49');
    expect(minorUnitsToInputValue('5', 'EUR')).toBe('0.05');
    expect(minorUnitsToInputValue('-1349', 'EUR')).toBe('-13.49');
  });
});

describe('dates', () => {
  it('convertit une date ISO en date/heure UTC', () => {
    expect(isoDateToDateTime('2026-09-05')).toBe('2026-09-05T00:00:00.000Z');
  });

  it('refuse une date que le calendrier ne contient pas', () => {
    expect(isoDateToDateTime('2026-02-31')).toBeNull();
    expect(isoDateToDateTime('2026-13-01')).toBeNull();
  });

  it.each([['05/09/2026'], ['2026-9-5'], [''], ['hier']])('refuse « %s »', (input) => {
    expect(isoDateToDateTime(input)).toBeNull();
  });

  it('extrait la date d’une date/heure ISO', () => {
    expect(dateTimeToIsoDate('2026-09-05T14:32:11.000Z')).toBe('2026-09-05');
  });
});

describe('validation du formulaire de transaction', () => {
  const base: ExpenseFormValues = {
    merchant: 'Boulangerie',
    amount: '13.49',
    date: '2026-09-05',
    category: 'FOOD',
    notes: '',
  };

  it('accepte une saisie complète', () => {
    expect(isExpenseFormValid(validateExpenseForm(base, 'EUR'))).toBe(true);
  });

  it('signale chaque champ en faute séparément', () => {
    const errors = validateExpenseForm(
      { ...base, merchant: '  ', amount: '0', date: '2026-02-31' },
      'EUR',
    );

    expect(errors).toEqual({ merchant: 'merchant', amount: 'amount', date: 'date' });
  });

  it('rend le libellé facultatif sur une ligne importée', () => {
    // Un champ vide y signifie « conserver le libellé du relevé ».
    const errors = validateExpenseForm({ ...base, merchant: '' }, 'EUR', {
      merchantOptional: true,
    });

    expect(errors.merchant).toBeUndefined();
    expect(isExpenseFormValid(errors)).toBe(true);
  });
});
