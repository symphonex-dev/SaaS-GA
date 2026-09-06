import { describe, expect, it } from 'vitest';

import {
  getEffectiveMerchantName,
  merchantComparisonKey,
  normalizeMerchant,
} from '@/lib/merchant/normalize';

/** `specs/import-releves.md` §9 et §12. */
describe('normalisation des commerçants', () => {
  it.each([
    ['NETFLIX.COM AMSTERDAM', 'Netflix'],
    ['SPOTIFY AB STOCKHOLM', 'Spotify'],
    ['netflix.com', 'Netflix'],
    ['PAIEMENT CB NETFLIX.COM', 'Netflix'],
    ['DISNEY+ LONDON', 'Disney+'],
    ['GOOGLE ONE', 'Google One'],
  ])('normalise %j en %j', (raw, expected) => {
    expect(normalizeMerchant(raw).normalized).toBe(expected);
  });

  it('regroupe les variantes connues d’un même commerçant', () => {
    const variantes = ['NETFLIX.COM AMSTERDAM', 'NETFLIX.COM', 'Netflix.com  NLD', 'NETFLIX'];
    const normalisees = new Set(variantes.map((raw) => normalizeMerchant(raw).normalized));

    expect(normalisees).toEqual(new Set(['Netflix']));
  });

  it('ne modifie jamais le libellé brut', () => {
    const raw = '  CARTE 12/03 NETFLIX.COM AMSTERDAM  ';

    expect(normalizeMerchant(raw).raw).toBe(raw);
  });

  it('ne supprime pas un chiffre significatif', () => {
    expect(normalizeMerchant('7-ELEVEN').normalized).toBe('7-Eleven');
    expect(normalizeMerchant('MICROSOFT 365').normalized).toBe('Microsoft 365');
  });

  it('supprime les identifiants transactionnels évidents', () => {
    expect(normalizeMerchant('CARTE 12/03 BOULANGERIE MARTIN 4972830183').normalized).toBe(
      'Boulangerie Martin',
    );
    expect(normalizeMerchant('PRLV SEPA EDF REF:9928374651').normalized).toBe('Edf');
  });

  it('conserve les accents dans le libellé affiché', () => {
    expect(normalizeMerchant('ÉLECTRICITÉ DE FRANCE').normalized).toBe('Électricité De France');
  });

  it('est déterministe : deux exécutions donnent le même résultat', () => {
    const entrees = [
      'NETFLIX.COM AMSTERDAM',
      'CARTE 12/03 BOULANGERIE MARTIN 4972830183',
      'ÉLECTRICITÉ DE FRANCE',
      '7-ELEVEN',
      'SPOTIFY AB STOCKHOLM',
    ];

    for (const entree of entrees) {
      const premier = normalizeMerchant(entree);
      const second = normalizeMerchant(entree);

      expect(second).toEqual(premier);
    }
  });

  it('produit des jetons comparables sans accent ni ponctuation', () => {
    expect(normalizeMerchant('Électricité De France').tokens).toEqual([
      'electricite',
      'de',
      'france',
    ]);
  });

  it('rapproche deux libellés qui ne diffèrent que par le format', () => {
    expect(merchantComparisonKey('Électricité De France')).toBe(
      merchantComparisonKey('ELECTRICITE  de   france'),
    );
    expect(merchantComparisonKey('Netflix')).not.toBe(merchantComparisonKey('Spotify'));
  });

  it('ne vide jamais un libellé, même entièrement composé de bruit', () => {
    expect(normalizeMerchant('CARTE').normalized.length).toBeGreaterThan(0);
  });
});

describe('priorité de la correction manuelle', () => {
  it('affiche la correction de l’utilisateur plutôt que la valeur normalisée', () => {
    expect(
      getEffectiveMerchantName({
        merchantNormalized: 'Netflix',
        merchantOverride: 'Netflix (compte famille)',
      }),
    ).toBe('Netflix (compte famille)');
  });

  it('retombe sur la valeur normalisée si la correction est absente ou vide', () => {
    expect(getEffectiveMerchantName({ merchantNormalized: 'Netflix' })).toBe('Netflix');
    expect(
      getEffectiveMerchantName({ merchantNormalized: 'Netflix', merchantOverride: null }),
    ).toBe('Netflix');
    expect(
      getEffectiveMerchantName({ merchantNormalized: 'Netflix', merchantOverride: '   ' }),
    ).toBe('Netflix');
  });
});
