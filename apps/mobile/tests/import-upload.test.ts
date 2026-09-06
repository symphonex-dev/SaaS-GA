import { describe, expect, it } from 'vitest';

import {
  CSV_MIME_TYPES,
  PDF_MIME_TYPE,
  buildImportFormData,
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
const file = { uri: 'file:///cache/releve.csv', name: 'releve.csv', mimeType: 'text/csv' };

/**
 * Double de `FormData` reproduisant le comportement de React Native : la valeur
 * `{ uri, name, type }` est **conservée telle quelle**, alors que
 * l'implémentation de Node la convertirait en `'[object Object]'`. C'est le
 * moteur natif qui lit l'URI au moment de l'envoi.
 */
function recordingFormData(): { form: FormData; entries: Record<string, unknown> } {
  const entries: Record<string, unknown> = {};
  const form = {
    append(key: string, value: unknown): void {
      entries[key] = value;
    },
  } as unknown as FormData;

  return { form, entries };
}

function entriesOf(
  file: Parameters<typeof buildImportFormData>[0],
  options?: Parameters<typeof buildImportFormData>[1],
): Record<string, unknown> {
  const { form, entries } = recordingFormData();

  buildImportFormData(file, options ?? {}, form);

  return entries;
}

describe('corps multipart', () => {
  it('transporte le fichier sous la forme attendue par React Native', () => {
    const entry = entriesOf(file)['file'];

    expect(entry).toEqual({
      uri: 'file:///cache/releve.csv',
      name: 'releve.csv',
      type: 'text/csv',
    });
  });

  it('n’ajoute aucun champ optionnel quand aucun n’est fourni', () => {
    expect(Object.keys(entriesOf(file))).toEqual(['file']);
  });

  it('ajoute le délimiteur, l’ordre de date et la correspondance de colonnes', () => {
    const entries = entriesOf(file, {
      delimiter: ';',
      dateOrder: 'DMY',
      mapping: { dateColumn: 0, descriptionColumn: 2, amountColumn: 5 },
    });

    expect(entries['delimiter']).toBe(';');
    expect(entries['dateOrder']).toBe('DMY');
    expect(entries['mapping']).toBe('{"dateColumn":0,"descriptionColumn":2,"amountColumn":5}');
  });

  it('ne transporte aucun contenu de relevé : seulement une URI locale', () => {
    const serialized = JSON.stringify(entriesOf(file));

    expect(serialized).not.toContain('amount');
    expect(serialized).toContain('file:///cache/releve.csv');
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
