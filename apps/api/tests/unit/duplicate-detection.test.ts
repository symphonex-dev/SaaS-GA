import { describe, expect, it } from 'vitest';

import {
  findDuplicates,
  findInFileDuplicates,
  findRefunds,
  type ExistingExpense,
  type ImportedRow,
} from '@/lib/csv/duplicate';

/** `specs/import-releves.md` §6 et §8, §12. */
function existing(overrides: Partial<ExistingExpense> = {}): ExistingExpense {
  return {
    id: 'exp_1',
    amountMinorUnits: 1349n,
    currency: 'EUR',
    date: '2026-01-05',
    merchantNormalized: 'Netflix',
    direction: 'DEBIT',
    ...overrides,
  };
}

function imported(overrides: Partial<ImportedRow> = {}): ImportedRow {
  return {
    rowNumber: 2,
    amountMinorUnits: 1349n,
    currency: 'EUR',
    date: '2026-01-05',
    merchantNormalized: 'Netflix',
    direction: 'DEBIT',
    ...overrides,
  };
}

describe('détection des doublons', () => {
  it('marque HIGH un doublon certain (même date, montant, devise, commerçant)', () => {
    const candidates = findDuplicates([imported()], [existing()]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      existingExpenseId: 'exp_1',
      importedRowNumber: 2,
      confidence: 'HIGH',
    });
  });

  it('tolère une différence de format sur le libellé du commerçant', () => {
    const candidates = findDuplicates(
      [imported({ merchantNormalized: 'NETFLIX' })],
      [existing({ merchantNormalized: 'Netflix' })],
    );

    expect(candidates[0]?.confidence).toBe('HIGH');
  });

  it('marque MEDIUM un doublon probable décalé de quelques jours', () => {
    const candidates = findDuplicates([imported({ date: '2026-01-07' })], [existing()]);

    expect(candidates[0]?.confidence).toBe('MEDIUM');
  });

  it('n’applique aucune tolérance financière', () => {
    // Un centime d'écart n'est pas un doublon.
    expect(findDuplicates([imported({ amountMinorUnits: 1350n })], [existing()])).toHaveLength(0);
  });

  it('ne rapproche jamais deux devises différentes', () => {
    expect(findDuplicates([imported({ currency: 'USD' })], [existing()])).toHaveLength(0);
  });

  it('ne rapproche pas deux commerçants différents', () => {
    expect(
      findDuplicates([imported({ merchantNormalized: 'Spotify' })], [existing()]),
    ).toHaveLength(0);
  });

  it('ignore une dépense trop éloignée dans le temps', () => {
    expect(findDuplicates([imported({ date: '2026-02-05' })], [existing()])).toHaveLength(0);
  });

  it('ne consomme jamais deux fois la même dépense existante', () => {
    const candidates = findDuplicates(
      [imported({ rowNumber: 2 }), imported({ rowNumber: 3 })],
      [existing()],
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.importedRowNumber).toBe(2);
  });

  it('ne rapproche jamais les dépenses de deux utilisateurs différents', () => {
    // Le repository ne charge que les dépenses de l'utilisateur courant : une
    // liste vide représente ici un utilisateur qui n'a aucune dépense, alors
    // même qu'un autre utilisateur possède exactement la même transaction.
    expect(findDuplicates([imported()], [])).toHaveLength(0);
  });
});

describe('doublons internes au fichier', () => {
  it('signale la seconde occurrence et conserve la première', () => {
    const duplicates = findInFileDuplicates([
      imported({ rowNumber: 2 }),
      imported({ rowNumber: 3 }),
      imported({ rowNumber: 4, amountMinorUnits: 999n }),
    ]);

    expect(duplicates).toEqual([3]);
  });
});

describe('détection des remboursements', () => {
  it('rapproche un crédit d’un débit identique du même commerçant', () => {
    const matches = findRefunds([
      imported({ rowNumber: 2, direction: 'DEBIT' }),
      imported({ rowNumber: 3, direction: 'CREDIT', date: '2026-01-20' }),
    ]);

    expect(matches).toEqual([{ creditRowNumber: 3, debitRowNumber: 2 }]);
  });

  it('ne rapproche pas un crédit d’un montant différent', () => {
    const matches = findRefunds([
      imported({ rowNumber: 2, direction: 'DEBIT' }),
      imported({ rowNumber: 3, direction: 'CREDIT', amountMinorUnits: 500n }),
    ]);

    expect(matches).toEqual([]);
  });

  it('ne rapproche pas un crédit hors de la fenêtre temporelle', () => {
    const matches = findRefunds([
      imported({ rowNumber: 2, direction: 'DEBIT', date: '2026-01-05' }),
      imported({ rowNumber: 3, direction: 'CREDIT', date: '2026-08-05' }),
    ]);

    expect(matches).toEqual([]);
  });

  it('ne rapproche pas deux commerçants différents', () => {
    const matches = findRefunds([
      imported({ rowNumber: 2, direction: 'DEBIT' }),
      imported({ rowNumber: 3, direction: 'CREDIT', merchantNormalized: 'Spotify' }),
    ]);

    expect(matches).toEqual([]);
  });

  it('n’utilise jamais deux fois le même débit', () => {
    const matches = findRefunds([
      imported({ rowNumber: 2, direction: 'DEBIT' }),
      imported({ rowNumber: 3, direction: 'CREDIT', date: '2026-01-10' }),
      imported({ rowNumber: 4, direction: 'CREDIT', date: '2026-01-12' }),
    ]);

    expect(matches).toEqual([{ creditRowNumber: 3, debitRowNumber: 2 }]);
  });
});
