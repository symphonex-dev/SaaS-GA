import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/api/errors';
import { decodeCsvBuffer, looksBinary } from '@/lib/csv/encoding';
import { detectDelimiter } from '@/lib/csv/delimiter';
import { detectMapping, looksLikeHeaderRow } from '@/lib/csv/mapping';
import { parseCsv } from '@/lib/csv/parser';
import { analyzeCsv } from '@/lib/import/analyze-csv';
import { assertFileSize } from '@/lib/import/file-guard';
import type { RowAnalysisContext } from '@/lib/import/analyze';

/** `specs/import-releves.md` §4.1 à §4.4 et §12. */
const context: RowAnalysisContext = {
  dateOrder: 'DMY',
  decimalHint: 'comma',
  defaultCurrency: 'EUR',
};

function analyze(csv: string, maxRows = 10_000) {
  return analyzeCsv(Buffer.from(csv, 'utf8'), { maxRows, context });
}

describe('détection du séparateur', () => {
  it.each([
    [',', 'date,libelle,montant\n05/01/2026,NETFLIX,-13,49'],
    [';', 'date;libelle;montant\n05/01/2026;NETFLIX;-13,49'],
    ['\t', 'date\tlibelle\tmontant\n05/01/2026\tNETFLIX\t-13,49'],
  ])('détecte le séparateur %j', (expected, csv) => {
    expect(detectDelimiter(csv)?.delimiter).toBe(expected);
  });

  it('ignore les séparateurs situés dans un champ quoté', () => {
    const csv = 'date;libelle;montant\n05/01/2026;"NETFLIX, AMSTERDAM";13,49';

    expect(detectDelimiter(csv)?.delimiter).toBe(';');
  });

  it('renvoie null sur un fichier sans structure de colonnes', () => {
    expect(detectDelimiter('une seule colonne\nsans separateur')).toBeNull();
  });
});

describe('parsing CSV', () => {
  it('ne coupe jamais un champ quoté contenant le séparateur', () => {
    const result = parseCsv('a,"b,c",d', ',');

    expect(result.rows).toEqual([['a', 'b,c', 'd']]);
  });

  it('gère les guillemets échappés', () => {
    const result = parseCsv('a,"il a dit ""oui""",c', ',');

    expect(result.rows[0]?.[1]).toBe('il a dit "oui"');
  });

  it('gère un retour à la ligne dans un champ quoté', () => {
    const result = parseCsv('a,"ligne1\nligne2",c\nd,e,f', ',');

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.[1]).toBe('ligne1\nligne2');
  });

  it('gère les champs vides et les fins de ligne CRLF', () => {
    const result = parseCsv('a,,c\r\nd,e,\r\n', ',');

    expect(result.rows).toEqual([
      ['a', '', 'c'],
      ['d', 'e', ''],
    ]);
  });

  it('signale un champ quoté non refermé', () => {
    expect(parseCsv('a,"b', ',').unterminatedQuote).toBe(true);
  });

  it('conserve les espaces internes des champs quotés', () => {
    expect(parseCsv('"  espace  ",b', ',').rows[0]?.[0]).toBe('  espace  ');
  });
});

describe('encodages', () => {
  it('décode l’UTF-8 en conservant les accents', () => {
    const result = decodeCsvBuffer(Buffer.from('Électricité;Crédit Agricole', 'utf8'));

    expect(result.encoding).toBe('utf-8');
    expect(result.text).toBe('Électricité;Crédit Agricole');
  });

  it('décode l’UTF-8 avec BOM sans laisser le BOM dans le texte', () => {
    const buffer = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('date;montant', 'utf8'),
    ]);
    const result = decodeCsvBuffer(buffer);

    expect(result.encoding).toBe('utf-8-bom');
    expect(result.text).toBe('date;montant');
  });

  it('replie sur ISO-8859-1 et conserve les accents', () => {
    const result = decodeCsvBuffer(Buffer.from('Électricité;Crédit', 'latin1'));

    expect(result.encoding).toBe('iso-8859-1');
    expect(result.text).toBe('Électricité;Crédit');
  });

  it('détecte un contenu binaire', () => {
    expect(looksBinary(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]))).toBe(true);
    expect(looksBinary(Buffer.from('date;montant', 'utf8'))).toBe(false);
  });
});

describe('mapping des colonnes', () => {
  it('reconnaît une ligne d’en-tête', () => {
    expect(looksLikeHeaderRow(['Date', 'Libellé', 'Montant'])).toBe(true);
    expect(looksLikeHeaderRow(['05/01/2026', 'NETFLIX', '-13,49'])).toBe(false);
  });

  it('mappe les en-têtes français et anglais', () => {
    expect(detectMapping(['Date', 'Libellé', 'Montant']).mapping).toEqual({
      dateColumn: 0,
      amountColumn: 2,
      descriptionColumn: 1,
    });

    const anglais = detectMapping(['Transaction Date', 'Description', 'Amount', 'Currency']);

    expect(anglais.mapping).toMatchObject({
      dateColumn: 0,
      descriptionColumn: 1,
      amountColumn: 2,
      currencyColumn: 3,
    });
  });

  it('reconnaît des colonnes débit/crédit séparées', () => {
    const detected = detectMapping(['Date', 'Libellé', 'Débit', 'Crédit']);

    expect(detected.mapping).toMatchObject({ debitColumn: 2, creditColumn: 3 });
  });

  it('signale les colonnes obligatoires absentes', () => {
    const detected = detectMapping(['Colonne A', 'Colonne B']);

    expect(detected.mapping).toBeNull();
    expect(detected.missing).toEqual(['date', 'description', 'amount']);
  });
});

describe('contrôles de fichier', () => {
  it('rejette un fichier vide', () => {
    expect(() => assertFileSize(Buffer.alloc(0), 1024)).toThrow(AppError);
    expect(() => analyze('')).toThrow(AppError);
  });

  it('rejette un fichier trop volumineux', () => {
    try {
      assertFileSize(Buffer.alloc(2048), 1024);
      expect.unreachable('la taille aurait dû être refusée');
    } catch (error) {
      expect((error as AppError).code).toBe('IMPORT_FILE_TOO_LARGE');
    }
  });

  it('rejette un fichier comportant trop de lignes', () => {
    const lines = ['date;libelle;montant'];

    for (let index = 0; index < 5; index += 1) {
      lines.push(`0${String(index + 1)}/01/2026;NETFLIX;-13,49`);
    }

    try {
      analyze(lines.join('\n'), 3);
      expect.unreachable('le nombre de lignes aurait dû être refusé');
    } catch (error) {
      expect((error as AppError).code).toBe('IMPORT_FILE_TOO_MANY_ROWS');
    }
  });

  it('exige un mapping quand les colonnes obligatoires sont introuvables', () => {
    try {
      analyze('col_a;col_b;col_c\n1;2;3');
      expect.unreachable('le mapping aurait dû être exigé');
    } catch (error) {
      expect((error as AppError).code).toBe('IMPORT_MAPPING_REQUIRED');
    }
  });

  it('rejette un CSV contenant du HTML', () => {
    try {
      analyze('<html><body>pas un csv</body></html>');
      expect.unreachable('le contenu actif aurait dû être refusé');
    } catch (error) {
      expect((error as AppError).code).toBe('IMPORT_FILE_INVALID');
    }
  });
});

describe('analyse complète d’un CSV', () => {
  const csv = [
    'Date;Libellé;Montant',
    '05/01/2026;NETFLIX.COM AMSTERDAM;-13,49',
    '07/01/2026;SPOTIFY AB STOCKHOLM;-11,99',
  ].join('\n');

  it('produit des lignes valides normalisées', () => {
    const analysis = analyze(csv);

    expect(analysis.delimiter).toBe(';');
    expect(analysis.headers).toEqual(['Date', 'Libellé', 'Montant']);
    expect(analysis.rows).toHaveLength(2);
    expect(analysis.rows[0]).toMatchObject({
      rowNumber: 2,
      status: 'VALID',
      parsed: {
        merchantNormalized: 'Netflix',
        amount: '13.49',
        currency: 'EUR',
        date: '2026-01-05',
        direction: 'DEBIT',
      },
    });
  });

  it('numérote les lignes en tenant compte de l’en-tête', () => {
    const analysis = analyze(csv);

    expect(analysis.rows.map((row) => row.rowNumber)).toEqual([2, 3]);
  });

  it('signale les colonnes manquantes ligne par ligne', () => {
    const analysis = analyze(
      ['Date;Libellé;Montant', '05/01/2026;;-13,49', ';NETFLIX;'].join('\n'),
    );

    expect(analysis.rows[0]?.status).toBe('INVALID');
    expect(analysis.rows[0]?.errors.map((error) => error.code)).toContain(
      'CSV_MISSING_DESCRIPTION',
    );
    expect(analysis.rows[1]?.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['CSV_MISSING_DATE', 'CSV_MISSING_AMOUNT']),
    );
  });

  it('rejette une devise non supportée', () => {
    const analysis = analyze(
      ['Date;Libellé;Montant;Devise', '05/01/2026;NETFLIX;13,49;CHF'].join('\n'),
    );

    expect(analysis.rows[0]?.errors.map((error) => error.code)).toContain('CSV_INVALID_CURRENCY');
  });
});
