import { describe, expect, it } from 'vitest';

import {
  CSV_MIME_TYPES,
  PDF_MIME_TYPE,
  buildImportUploadParameters,
  importUploadFileName,
  resolveMimeType,
} from '../lib/import-upload';
import {
  IMPORT_STATE_LABEL_KEYS,
  acceptedRowNumbers,
  previewState,
  type ImportState,
} from '../lib/import-state';
import type { ImportPreviewDto } from '@subscription-manager/shared';

/**
 * Envoi du relevé et machine à états de l'import (mission §14, §15 et §22).
 *
 * Aucun parsing métier n'est testé ici : il n'y en a aucun côté mobile. Le
 * fichier part tel quel, et le serveur revalide tout (CLAUDE.md §5.1 et §5.4).
 */
describe('champs accompagnant le fichier', () => {
  it('n’ajoute aucun champ optionnel quand aucun n’est fourni', () => {
    expect(buildImportUploadParameters()).toEqual({});
  });

  it('ajoute le délimiteur, l’ordre de date et la correspondance de colonnes', () => {
    const parameters = buildImportUploadParameters({
      delimiter: ';',
      dateOrder: 'DMY',
      mapping: { dateColumn: 0, descriptionColumn: 2, amountColumn: 5 },
    });

    expect(parameters['delimiter']).toBe(';');
    expect(parameters['dateOrder']).toBe('DMY');
    expect(parameters['mapping']).toBe('{"dateColumn":0,"descriptionColumn":2,"amountColumn":5}');
  });

  it('ne transporte que ce que le serveur a explicitement demandé', () => {
    const parameters = buildImportUploadParameters({ delimiter: ',' });

    // Ni source, ni statut, ni identifiant : le serveur les fixe lui-même.
    expect(Object.keys(parameters)).toEqual(['delimiter']);
  });
});

/**
 * Nom d'envoi (`importUploadFileName`).
 *
 * L'extension n'est pas cosmétique : `resolveSourceType`, côté serveur, en
 * déduit CSV ou PDF avant même de regarder le contenu. La copie déposée par
 * `expo-document-picker` s'appelle `<uuid>pdf` — sans point — et serait donc
 * lue comme un fichier sans extension.
 */
describe('nom sous lequel le relevé est envoyé', () => {
  it('impose l’extension correspondant à la nature choisie', () => {
    expect(importUploadFileName('releve', 'PDF')).toBe('releve.pdf');
    expect(importUploadFileName('releve', 'CSV')).toBe('releve.csv');
  });

  it('remplace l’extension d’origine plutôt que de l’empiler', () => {
    expect(importUploadFileName('releve.csv', 'PDF')).toBe('releve.pdf');
  });

  it('donne une extension à la copie sans point du sélecteur Android', () => {
    expect(importUploadFileName('0c8f2a1b4e7d4f0a9c3b5e6d7a8f9b0cpdf', 'PDF')).toBe(
      '0c8f2a1b4e7d4f0a9c3b5e6d7a8f9b0cpdf.pdf',
    );
  });

  it('replie les accents sans rendre le nom méconnaissable', () => {
    expect(importUploadFileName('Relevé de compte août.pdf', 'PDF')).toBe(
      'Releve de compte aout.pdf',
    );
  });

  it('ne produit jamais un chemin, seulement un nom de fichier', () => {
    const name = importUploadFileName('../../etc/passwd.csv', 'CSV');

    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
    expect(name.startsWith('.')).toBe(false);
    expect(name.endsWith('.csv')).toBe(true);
  });

  it('retombe sur un nom neutre quand rien d’exploitable ne subsiste', () => {
    expect(importUploadFileName('統計.pdf', 'PDF')).toBe('statement.pdf');
    expect(importUploadFileName('   ', 'CSV')).toBe('statement.csv');
  });

  it('borne la longueur sans perdre l’extension', () => {
    const name = importUploadFileName(`${'a'.repeat(300)}.pdf`, 'PDF');

    expect(name.endsWith('.pdf')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(68);
  });
});

describe('type MIME absent du sélecteur de documents', () => {
  it('retombe sur un type CSV plausible', () => {
    expect(resolveMimeType(undefined, 'CSV')).toBe('text/csv');
    expect(resolveMimeType(null, 'CSV')).toBe('text/csv');
    expect(resolveMimeType('   ', 'CSV')).toBe('text/csv');
  });

  it('retombe sur application/pdf pour un import PDF', () => {
    expect(resolveMimeType(undefined, 'PDF')).toBe(PDF_MIME_TYPE);
  });

  it('conserve un type fourni', () => {
    expect(resolveMimeType('application/vnd.ms-excel', 'CSV')).toBe('application/vnd.ms-excel');
  });

  it('propose les types CSV que les fournisseurs Android renvoient réellement', () => {
    expect(CSV_MIME_TYPES).toContain('text/csv');
    expect(CSV_MIME_TYPES).toContain('text/plain');
    expect(CSV_MIME_TYPES).toContain('application/vnd.ms-excel');
  });
});

function preview(overrides: Partial<ImportPreviewDto> = {}): ImportPreviewDto {
  return {
    importId: 'imp_1',
    sourceType: 'CSV',
    defaultCurrency: 'EUR',
    dateOrder: 'DMY',
    counts: { total: 2, valid: 2, duplicate: 0, invalid: 0, refund: 0, skipped: 0 },
    rows: [
      { rowNumber: 1, status: 'VALID', errors: [] },
      { rowNumber: 2, status: 'VALID', errors: [] },
    ],
    duplicates: [],
    warningKeys: [],
    ...overrides,
  } as unknown as ImportPreviewDto;
}

describe("machine à états de l'import", () => {
  it('déclare un libellé traduit pour chacun des neuf états', () => {
    const states: ImportState[] = [
      'idle',
      'uploading',
      'parsing',
      'preview',
      'validation_error',
      'ready_to_import',
      'importing',
      'completed',
      'rollback_available',
    ];

    for (const state of states) {
      expect(IMPORT_STATE_LABEL_KEYS[state]).toMatch(/^import\.states\./);
    }

    expect(Object.keys(IMPORT_STATE_LABEL_KEYS)).toHaveLength(states.length);
  });

  it('passe à ready_to_import dès qu’une ligne insérable est retenue', () => {
    expect(previewState(preview(), new Set())).toBe('ready_to_import');
  });

  it('revient à preview quand l’utilisateur a tout exclu', () => {
    expect(previewState(preview(), new Set([1, 2]))).toBe('preview');
  });

  it('signale validation_error dès qu’une ligne est illisible', () => {
    const withInvalid = preview({
      counts: { total: 2, valid: 1, duplicate: 0, invalid: 1, refund: 0, skipped: 0 },
    });

    expect(previewState(withInvalid, new Set())).toBe('validation_error');
  });

  it('ne retient que les lignes que le serveur juge insérables', () => {
    const mixed = preview({
      counts: { total: 3, valid: 1, duplicate: 1, invalid: 0, refund: 0, skipped: 1 },
      rows: [
        { rowNumber: 1, status: 'VALID', errors: [] },
        { rowNumber: 2, status: 'DUPLICATE', errors: [] },
        { rowNumber: 3, status: 'SKIPPED', errors: [] },
      ],
      duplicates: [{ importedRowNumber: 2, confidence: 'MEDIUM' }],
    } as unknown as Partial<ImportPreviewDto>);

    expect(acceptedRowNumbers(mixed, new Set())).toEqual([1, 2]);
  });

  it('n’accepte jamais un doublon de confiance haute, même non exclu', () => {
    const highDuplicate = preview({
      rows: [
        { rowNumber: 1, status: 'VALID', errors: [] },
        { rowNumber: 2, status: 'DUPLICATE', errors: [] },
      ],
      duplicates: [{ importedRowNumber: 2, confidence: 'HIGH' }],
    } as unknown as Partial<ImportPreviewDto>);

    expect(acceptedRowNumbers(highDuplicate, new Set())).toEqual([1]);
  });
});
