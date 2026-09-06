import { describe, expect, it } from 'vitest';

import { decimalHintForCountry, parseMoney } from '@/lib/csv/amount';
import {
  decimalStringToMinorUnits,
  minorUnitsToDatabaseDecimal,
  minorUnitsToDecimalString,
} from '@/lib/finance/money';

/** `specs/import-releves.md` §4.5 et §12 ; CLAUDE.md §5.2. */
describe('analyse des montants', () => {
  it.each([
    ['12.99', '12.99'],
    ['12,99', '12.99'],
    ['1 234,56', '1234.56'],
    ['1.234,56', '1234.56'],
    ['1,234.56', '1234.56'],
    ['1234.56', '1234.56'],
    ['0,99', '0.99'],
    ['1.234.567,89', '1234567.89'],
  ])('interprète %j comme %j', (input, expected) => {
    expect(parseMoney(input)?.value).toBe(expected);
  });

  it.each([
    ['-13,49', 'negative'],
    ['13,49-', 'negative'],
    ['(13,49)', 'negative'],
    ['13,49', 'positive'],
    ['+13,49', 'positive'],
  ])('détecte le signe de %j', (input, sign) => {
    expect(parseMoney(input)?.sign).toBe(sign);
  });

  it('ignore les symboles et codes de devise', () => {
    expect(parseMoney('€ 13,49')?.value).toBe('13.49');
    expect(parseMoney('13.49 USD')?.value).toBe('13.49');
    expect(parseMoney('£12.99')?.value).toBe('12.99');
  });

  it('gère l’espace insécable comme séparateur de milliers', () => {
    expect(parseMoney('1 234,56')?.value).toBe('1234.56');
    expect(parseMoney('1 234,56')?.value).toBe('1234.56');
  });

  it('tranche « 1,234 » avec la locale, jamais au hasard', () => {
    // Locale à point décimal (US) : la virgule est un séparateur de milliers.
    expect(parseMoney('1,234', 'dot')?.value).toBe('1234');
    // Locale à virgule décimale (FR) : la virgule sépare les décimales.
    expect(parseMoney('1,234', 'comma')?.value).toBe('1.234');
  });

  it.each(['', '   ', 'abc', '12,34,56,78', 'N/A', '--12'])(
    'rejette la valeur inexploitable %j',
    (input) => {
      expect(parseMoney(input)).toBeNull();
    },
  );

  it('déduit le séparateur décimal du pays choisi à l’onboarding', () => {
    expect(decimalHintForCountry('US')).toBe('dot');
    expect(decimalHintForCountry('GB')).toBe('dot');
    expect(decimalHintForCountry('FR')).toBe('comma');
    expect(decimalHintForCountry('ES')).toBe('comma');
  });
});

describe('conversion en unités mineures', () => {
  it('convertit sans passer par un flottant', () => {
    expect(decimalStringToMinorUnits('13.49', 'EUR')).toBe(1349n);
    expect(decimalStringToMinorUnits('0.10', 'EUR')).toBe(10n);
    expect(decimalStringToMinorUnits('-13.49', 'EUR')).toBe(-1349n);
    expect(decimalStringToMinorUnits('1234567.89', 'USD')).toBe(123456789n);
  });

  it('refuse un montant plus précis que la devise', () => {
    // 0.1 + 0.2 en flottant vaudrait 0.30000000000000004 : le pipeline
    // n'accepte aucune valeur qui ne soit pas exactement représentable.
    expect(decimalStringToMinorUnits('13.499', 'EUR')).toBeNull();
    expect(decimalStringToMinorUnits('abc', 'EUR')).toBeNull();
  });

  it('reformate les unités mineures sans perte', () => {
    expect(minorUnitsToDecimalString(1349n, 'EUR')).toBe('13.49');
    expect(minorUnitsToDecimalString(5n, 'EUR')).toBe('0.05');
    expect(minorUnitsToDecimalString(-1349n, 'EUR')).toBe('-13.49');
    expect(minorUnitsToDecimalString(0n, 'EUR')).toBe('0.00');
  });

  it('produit la représentation attendue par Decimal(19, 4)', () => {
    expect(minorUnitsToDatabaseDecimal(1349n, 'EUR')).toBe('13.4900');
    expect(minorUnitsToDatabaseDecimal(5n, 'USD')).toBe('0.0500');
  });

  it('reste exact sur un aller-retour, y compris sur de grands montants', () => {
    for (const value of ['0.01', '13.49', '999999.99', '123456789.01']) {
      const minorUnits = decimalStringToMinorUnits(value, 'EUR');

      expect(minorUnits).not.toBeNull();
      expect(minorUnitsToDecimalString(minorUnits as bigint, 'EUR')).toBe(value);
    }
  });

  it('additionne sans erreur d’arrondi', () => {
    const cents = ['0.10', '0.20'].map((value) => decimalStringToMinorUnits(value, 'EUR') ?? 0n);
    const total = cents.reduce((sum, value) => sum + value, 0n);

    expect(minorUnitsToDecimalString(total, 'EUR')).toBe('0.30');
  });
});
