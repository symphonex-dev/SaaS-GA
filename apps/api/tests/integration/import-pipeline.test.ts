import type {
  AuthenticatedSessionDto,
  ImportConfirmResultDto,
  ImportPreviewDto,
} from '@subscription-manager/shared';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as confirmRoute } from '@/app/api/imports/confirm/route';
import { GET as getImportRoute } from '@/app/api/imports/[id]/route';
import { POST as previewRoute } from '@/app/api/imports/preview/route';
import { importTempDirectory } from '@/lib/import/temp-file';
import { resetRateLimits } from '@/lib/security/rate-limit';
import { resetPreviewStore } from '@/server/import/preview-store';

import { attachSubscription, createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { authenticatedUpload, CSV_RELEVE, previewImport } from '../helpers/import';
import { buildPdf } from '../helpers/pdf-fixture';
import { resetDatabase, tables } from '../helpers/prisma-mock';

// Répertoire temporaire propre à ce fichier de test : les fichiers de test
// s'exécutent en parallèle et partageraient sinon le même dossier.
process.env.IMPORT_TEMP_DIR = join(tmpdir(), `sm-import-tests-pipeline`);

/**
 * Pipeline d'import complet (`specs/import-releves.md` §2, §4 à §8, §10, §13).
 * L'offre Plus est attachée aux comptes de test : les quotas Free sont
 * couverts par leurs propres scénarios.
 */
describe('pipeline d’import', () => {
  let session: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();
    resetPreviewStore();
    vi.restoreAllMocks();

    session = await createUserWithSession({ email: 'import@example.com' });
    attachSubscription(session.user.id, { plan: 'PLUS', status: 'ACTIVE' });
  });

  async function confirm(body: unknown): Promise<Response> {
    return confirmRoute(
      apiRequest('/api/imports/confirm', { method: 'POST', token: session.token, body }),
    );
  }

  describe('aperçu CSV', () => {
    it('analyse le relevé sans créer aucune dépense', async () => {
      const preview = await previewImport(session.token, CSV_RELEVE);

      expect(preview.sourceType).toBe('CSV');
      expect(preview.delimiter).toBe(';');
      expect(preview.encoding).toBe('utf-8');
      expect(preview.counts.total).toBe(3);
      expect(preview.counts.valid).toBe(2);
      // Le virement de salaire est un crédit : jamais converti en dépense (§6).
      expect(preview.counts.skipped).toBe(1);
      expect(tables.expense.rows).toHaveLength(0);
      expect(tables.expenseImportBatch.rows).toHaveLength(0);
    });

    it('normalise les commerçants et conserve le libellé brut', async () => {
      const preview = await previewImport(session.token, CSV_RELEVE);
      const first = preview.rows[0];

      expect(first?.parsed?.merchantRaw).toBe('NETFLIX.COM AMSTERDAM');
      expect(first?.parsed?.merchantNormalized).toBe('Netflix');
    });

    it('indique l’ordre de date déduit du pays de l’utilisateur', async () => {
      const preview = await previewImport(session.token, CSV_RELEVE);

      expect(preview.dateOrder).toBe('DMY');
      expect(preview.rows[0]?.parsed?.date).toBe('2026-01-05');
    });

    it('accepte un séparateur imposé par l’utilisateur', async () => {
      const preview = await previewImport(
        session.token,
        'Date,Libellé,Montant\n05/01/2026,NETFLIX,-13.49',
        { delimiter: ',' },
      );

      expect(preview.delimiter).toBe(',');
    });

    it('supprime le fichier temporaire après traitement', async () => {
      await previewImport(session.token, CSV_RELEVE);

      const files = await readdir(importTempDirectory()).catch(() => []);

      expect(files).toHaveLength(0);
    });

    it('refuse un exécutable renommé en .csv', async () => {
      const response = await previewRoute(
        authenticatedUpload(session.token, Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), {
          filename: 'virus.csv',
        }),
      );

      expect(await expectErrorCode(response)).toBe('IMPORT_FILE_INVALID');
    });

    it('refuse un import sans session', async () => {
      const response = await previewRoute(
        new Request('https://api.test/api/imports/preview', { method: 'POST' }),
      );

      expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
    });
  });

  describe('confirmation', () => {
    it('insère uniquement les lignes acceptées, dans un lot', async () => {
      const preview = await previewImport(session.token, CSV_RELEVE);
      const acceptable = preview.rows
        .filter((row) => row.status === 'VALID')
        .map((row) => row.rowNumber);

      const response = await confirm({
        importId: preview.importId,
        acceptedRows: acceptable,
      });

      const result = await expectSuccess<ImportConfirmResultDto>(response);

      expect(result.batch.importedCount).toBe(2);
      expect(result.batch.rowCount).toBe(3);
      expect(tables.expense.rows).toHaveLength(2);
      expect(tables.expense.rows.every((row) => row['importBatchId'] === result.batch.id)).toBe(
        true,
      );
      expect(tables.expense.rows.every((row) => row['source'] === 'IMPORT')).toBe(true);
    });

    it('n’insère pas une ligne absente de acceptedRows', async () => {
      const preview = await previewImport(session.token, CSV_RELEVE);
      const first = preview.rows.find((row) => row.status === 'VALID');

      const response = await confirm({
        importId: preview.importId,
        acceptedRows: [first?.rowNumber ?? 0],
      });
      const result = await expectSuccess<ImportConfirmResultDto>(response);

      expect(result.batch.importedCount).toBe(1);
      expect(result.batch.rejectedCount).toBe(1);
      expect(tables.expense.rows).toHaveLength(1);
    });

    it('refuse une ligne invalide même si le client la déclare acceptée', async () => {
      const preview = await previewImport(
        session.token,
        ['Date;Libellé;Montant', '32/13/2026;NETFLIX;-13,49'].join('\n'),
      );

      const response = await confirm({
        importId: preview.importId,
        acceptedRows: [2],
      });
      const result = await expectSuccess<ImportConfirmResultDto>(response);

      expect(result.batch.importedCount).toBe(0);
      expect(result.rejectedRows).toHaveLength(1);
      expect(tables.expense.rows).toHaveLength(0);
    });

    it('refuse une confirmation dont l’aperçu a expiré', async () => {
      const preview = await previewImport(session.token, CSV_RELEVE);

      resetPreviewStore();

      const response = await confirm({ importId: preview.importId, acceptedRows: [2] });

      expect(await expectErrorCode(response)).toBe('IMPORT_PREVIEW_EXPIRED');
    });

    it('interdit de rejouer un aperçu déjà confirmé', async () => {
      const preview = await previewImport(session.token, CSV_RELEVE);

      await confirm({ importId: preview.importId, acceptedRows: [2] });
      const seconde = await confirm({ importId: preview.importId, acceptedRows: [3] });

      expect(await expectErrorCode(seconde)).toBe('IMPORT_PREVIEW_EXPIRED');
      expect(tables.expense.rows).toHaveLength(1);
    });

    it('rejette une ligne à la fois acceptée et rejetée', async () => {
      const preview = await previewImport(session.token, CSV_RELEVE);

      const response = await confirm({
        importId: preview.importId,
        acceptedRows: [2],
        rejectedRows: [2],
      });

      expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
    });

    it('applique un ordre de date corrigé à la confirmation', async () => {
      const csv = ['Date;Libellé;Montant', '03/04/2026;NETFLIX;-13,49'].join('\n');
      const preview = await previewImport(session.token, csv);

      expect(preview.rows[0]?.parsed?.date).toBe('2026-04-03');

      await confirm({ importId: preview.importId, acceptedRows: [2], dateOrder: 'MDY' });

      const stored = tables.expense.rows[0] as { date: Date };

      expect(stored.date.toISOString()).toBe('2026-03-04T00:00:00.000Z');
    });
  });

  describe('doublons', () => {
    it('exclut un doublon certain et l’expose dans l’aperçu', async () => {
      const preview = await previewImport(session.token, CSV_RELEVE);
      await confirm({ importId: preview.importId, acceptedRows: [2, 3] });

      const second = await previewImport(session.token, CSV_RELEVE);

      expect(second.duplicates).toHaveLength(2);
      expect(second.duplicates.every((entry) => entry.confidence === 'HIGH')).toBe(true);
      expect(second.counts.duplicate).toBe(2);

      const response = await confirm({ importId: second.importId, acceptedRows: [2, 3] });
      const result = await expectSuccess<ImportConfirmResultDto>(response);

      // Un doublon HIGH n'est jamais inséré, même explicitement accepté (§8).
      expect(result.batch.importedCount).toBe(0);
      expect(result.batch.duplicateCount).toBe(2);
      expect(tables.expense.rows).toHaveLength(2);
    });

    it('laisse l’utilisateur arbitrer un doublon probable', async () => {
      const premier = await previewImport(session.token, CSV_RELEVE);
      await confirm({ importId: premier.importId, acceptedRows: [2] });

      // Même transaction, deux jours plus tard : doublon seulement probable.
      const second = await previewImport(
        session.token,
        ['Date;Libellé;Montant', '07/01/2026;NETFLIX.COM AMSTERDAM;-13,49'].join('\n'),
      );

      expect(second.duplicates[0]?.confidence).toBe('MEDIUM');

      const response = await confirm({ importId: second.importId, acceptedRows: [2] });
      const result = await expectSuccess<ImportConfirmResultDto>(response);

      expect(result.batch.importedCount).toBe(1);
      expect(tables.expense.rows).toHaveLength(2);
    });

    it('signale un doublon interne au fichier', async () => {
      const preview = await previewImport(
        session.token,
        [
          'Date;Libellé;Montant',
          '05/01/2026;NETFLIX.COM;-13,49',
          '05/01/2026;NETFLIX.COM;-13,49',
        ].join('\n'),
      );

      expect(preview.counts.valid).toBe(1);
      expect(preview.counts.duplicate).toBe(1);
    });
  });

  describe('crédits et remboursements', () => {
    const csv = [
      'Date;Libellé;Montant',
      '05/01/2026;NETFLIX.COM AMSTERDAM;-13,49',
      '20/01/2026;NETFLIX.COM AMSTERDAM;13,49',
      '12/01/2026;VIREMENT SALAIRE;2450,00',
    ].join('\n');

    it('marque le crédit rapproché comme remboursement et l’exclut', async () => {
      const preview = await previewImport(session.token, csv);
      const refund = preview.rows.find((row) => row.status === 'REFUND');

      expect(refund?.rowNumber).toBe(3);
      expect(refund?.errors.map((error) => error.code)).toContain('CSV_REFUND');
      expect(preview.counts.refund).toBe(1);
    });

    it('n’insère jamais un crédit comme dépense négative', async () => {
      const preview = await previewImport(session.token, csv);

      await confirm({ importId: preview.importId, acceptedRows: [2, 3, 4] });

      expect(tables.expense.rows).toHaveLength(1);
      expect(tables.expense.rows[0]?.['amount']).toBe('13.49');
    });

    it('gère des colonnes débit et crédit séparées', async () => {
      const preview = await previewImport(
        session.token,
        [
          'Date;Libellé;Débit;Crédit',
          '05/01/2026;NETFLIX.COM;13,49;',
          '12/01/2026;SALAIRE;;2450,00',
        ].join('\n'),
      );

      expect(preview.rows[0]?.parsed?.direction).toBe('DEBIT');
      expect(preview.rows[0]?.parsed?.amount).toBe('13.49');
      expect(preview.rows[1]?.parsed?.direction).toBe('CREDIT');
      expect(preview.counts.skipped).toBe(1);
    });
  });

  describe('consultation d’un lot', () => {
    it('renvoie le lot et son nombre de dépenses', async () => {
      const preview = await previewImport(session.token, CSV_RELEVE);
      const confirmed = await expectSuccess<ImportConfirmResultDto>(
        await confirm({ importId: preview.importId, acceptedRows: [2, 3] }),
      );

      const response = await getImportRoute(
        apiRequest(`/api/imports/${confirmed.batch.id}`, { token: session.token }),
        { params: Promise.resolve({ id: confirmed.batch.id }) },
      );

      const body = await expectSuccess<{ batch: { id: string; expenseCount: number } }>(response);

      expect(body.batch.id).toBe(confirmed.batch.id);
      expect(body.batch.expenseCount).toBe(2);
    });
  });

  describe('import PDF', () => {
    const pdf = (): Buffer =>
      buildPdf([
        'RELEVE DE COMPTE - JANVIER 2026',
        '05/01/2026 NETFLIX.COM AMSTERDAM -13,49',
        '07/01/2026 SPOTIFY AB STOCKHOLM -11,99',
        'SOLDE AU 31/01/2026 1234,56',
      ]);

    async function previewPdf(): Promise<ImportPreviewDto> {
      const response = await previewRoute(
        authenticatedUpload(session.token, pdf(), {
          filename: 'releve.pdf',
          mimeType: 'application/pdf',
        }),
      );

      return expectSuccess<ImportPreviewDto>(response);
    }

    it('extrait les lignes de transaction et les qualifie', async () => {
      const preview = await previewPdf();

      // Les lignes d'en-tête et de solde restent présentes dans l'aperçu, en
      // INVALID : l'utilisateur voit ce qui a été écarté et pourquoi.
      const transactions = preview.rows.filter((row) => row.status === 'VALID');

      expect(preview.sourceType).toBe('PDF');
      expect(preview.counts.valid).toBe(2);
      expect(transactions[0]?.parsed?.merchantNormalized).toBe('Netflix');
      expect(transactions[0]?.parsed?.amount).toBe('13.49');
      expect(transactions[1]?.parsed?.merchantNormalized).toBe('Spotify');
    });

    it('accompagne l’aperçu du message de compatibilité limitée', async () => {
      const preview = await previewPdf();

      expect(preview.warningKeys).toContain('import.pdf.limitedCompatibility');
    });

    it('signale les lignes de faible confiance sans les insérer', async () => {
      const preview = await previewImport(
        session.token,
        buildPdf(['RELEVE JANVIER', 'ligne sans montant ni date exploitable 1234']),
        { filename: 'releve.pdf', mimeType: 'application/pdf' },
      );

      const faibles = preview.rows.filter((row) =>
        row.errors.some((error) => error.code === 'PDF_LOW_CONFIDENCE_LINE'),
      );

      expect(faibles.length).toBeGreaterThan(0);
      expect(faibles.every((row) => row.status === 'INVALID')).toBe(true);
    });

    it('refuse un PDF illisible', async () => {
      const response = await previewRoute(
        authenticatedUpload(session.token, Buffer.from('%PDF-1.4 contenu tronqué'), {
          filename: 'casse.pdf',
          mimeType: 'application/pdf',
        }),
      );

      expect(await expectErrorCode(response)).toBe('IMPORT_FILE_INVALID');
    });

    it('supprime le fichier temporaire même quand le traitement échoue', async () => {
      await previewRoute(
        authenticatedUpload(session.token, Buffer.from('%PDF-1.4 contenu tronqué'), {
          filename: 'casse.pdf',
          mimeType: 'application/pdf',
        }),
      );

      const files = await readdir(importTempDirectory()).catch(() => []);

      expect(files).toHaveLength(0);
    });
  });
});
