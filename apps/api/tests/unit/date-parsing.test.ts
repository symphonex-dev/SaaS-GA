import { dateOrderForCountry } from '@subscription-manager/shared';
import { describe, expect, it } from 'vitest';

import { isoDateToUtcDate, parseCsvDate } from '@/lib/csv/date';

/** `specs/import-releves.md` §4.6 et §12. */
describe('analyse des dates', () => {
  it.each([
    ['2026-01-05', '2026-01-05'],
    ['2026/01/05', '2026-01-05'],
    ['05/01/2026', '2026-01-05'],
    ['05-01-2026', '2026-01-05'],
    ['5/1/2026', '2026-01-05'],
    ['05.01.2026', '2026-01-05'],
  ])('interprète %j en DMY comme %j', (input, expected) => {
    const result = parseCsvDate(input, 'DMY');

    expect(result.ok && result.date.iso).toBe(expected);
  });

  it('interprète la même saisie différemment selon la locale', () => {
    const francais = parseCsvDate('03/04/2026', 'DMY');
    const americain = parseCsvDate('03/04/2026', 'MDY');

    expect(francais.ok && francais.date.iso).toBe('2026-04-03');
    expect(americain.ok && americain.date.iso).toBe('2026-03-04');
  });

  it('signale qu’une date ambiguë a dû être interprétée', () => {
    const result = parseCsvDate('03/04/2026', 'DMY');

    expect(result.ok && result.date.ambiguous).toBe(true);
  });

  it('ne devine jamais une date ambiguë sans indication de locale', () => {
    const result = parseCsvDate('03/04/2026');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('AMBIGUOUS');
  });

  it('ne marque pas ambiguë une date dont une seule lecture est possible', () => {
    // 25 ne peut pas être un mois : la lecture est certaine.
    const result = parseCsvDate('25/12/2026');

    expect(result.ok && result.date.iso).toBe('2026-12-25');
    expect(result.ok && result.date.ambiguous).toBe(false);
  });

  it('ne marque pas ambiguë une date dont les deux lectures coïncident', () => {
    const result = parseCsvDate('05/05/2026', 'DMY');

    expect(result.ok && result.date.ambiguous).toBe(false);
  });

  it('interprète un format ISO sans jamais le considérer ambigu', () => {
    const result = parseCsvDate('2026-03-04');

    expect(result.ok && result.date.iso).toBe('2026-03-04');
    expect(result.ok && result.date.ambiguous).toBe(false);
  });

  it.each(['31/02/2026', '2026-02-30', '32/01/2026', '00/01/2026', '2026-13-01'])(
    'rejette la date impossible %j',
    (input) => {
      const result = parseCsvDate(input, 'DMY');

      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toBe('INVALID');
    },
  );

  it('accepte le 29 février d’une année bissextile et rejette celui d’une année commune', () => {
    expect(parseCsvDate('29/02/2024', 'DMY').ok).toBe(true);
    expect(parseCsvDate('29/02/2026', 'DMY').ok).toBe(false);
  });

  it('signale une date absente distinctement d’une date invalide', () => {
    const vide = parseCsvDate('   ', 'DMY');
    const invalide = parseCsvDate('pas une date', 'DMY');

    expect(!vide.ok && vide.reason).toBe('MISSING');
    expect(!invalide.ok && invalide.reason).toBe('INVALID');
  });

  it('développe une année sur deux chiffres', () => {
    const recent = parseCsvDate('05/01/26', 'DMY');
    const ancien = parseCsvDate('05/01/98', 'DMY');

    expect(recent.ok && recent.date.iso).toBe('2026-01-05');
    expect(ancien.ok && ancien.date.iso).toBe('1998-01-05');
  });

  it('déduit l’ordre des dates du pays choisi à l’onboarding', () => {
    expect(dateOrderForCountry('US')).toBe('MDY');
    expect(dateOrderForCountry('FR')).toBe('DMY');
    expect(dateOrderForCountry('GB')).toBe('DMY');
    expect(dateOrderForCountry('ES')).toBe('DMY');
  });

  it('convertit une date ISO en instant UTC de minuit', () => {
    expect(isoDateToUtcDate('2026-01-05').toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });
});
