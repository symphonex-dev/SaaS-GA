import type { AuthenticatedSessionDto, ImportConfirmResultDto } from '@subscription-manager/shared';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as confirmRoute } from '@/app/api/imports/confirm/route';
import { GET as getImportRoute } from '@/app/api/imports/[id]/route';
import { POST as rollbackRoute } from '@/app/api/imports/[id]/rollback/route';
import { POST as previewRoute } from '@/app/api/imports/preview/route';
import * as analyzeCsvModule from '@/lib/import/analyze-csv';
import { importTempDirectory } from '@/lib/import/temp-file';
import { resetRateLimits } from '@/lib/security/rate-limit';
import { resetPreviewStore } from '@/server/import/preview-store';

import { attachSubscription, createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { authenticatedUpload, CSV_RELEVE, previewImport } from '../helpers/import';
import { resetDatabase, tables } from '../helpers/prisma-mock';

// Répertoire temporaire propre à ce fichier de test : les fichiers de test
// s'exécutent en parallèle et partageraient sinon le même dossier.
process.env.IMPORT_TEMP_DIR = join(tmpdir(), `sm-import-tests-isolation`);

/**
 * Isolation multi-utilisateur et rollback (`specs/import-releves.md` §10, §12 ;
 * `specs/auth-comptes-rgpd.md` §11).
 */
describe('isolation et rollback des imports', () => {
  let userA: AuthenticatedSessionDto;
  let userB: AuthenticatedSessionDto;
  let batchA: ImportConfirmResultDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();
    resetPreviewStore();
    vi.restoreAllMocks();

    userA = await createUserWithSession({ email: 'a@example.com' });
    userB = await createUserWithSession({ email: 'b@example.com' });
    attachSubscription(userA.user.id, { plan: 'PLUS', status: 'ACTIVE' });
    attachSubscription(userB.user.id, { plan: 'PLUS', status: 'ACTIVE' });

    const preview = await previewImport(userA.token, CSV_RELEVE);

    batchA = await expectSuccess<ImportConfirmResultDto>(
      await confirmRoute(
        apiRequest('/api/imports/confirm', {
          method: 'POST',
          token: userA.token,
          body: { importId: preview.importId, acceptedRows: [2, 3] },
        }),
      ),
    );
  });

  function getImport(token: string, id: string): Promise<Response> {
    return getImportRoute(apiRequest(`/api/imports/${id}`, { token }), {
      params: Promise.resolve({ id }),
    });
  }

  function rollback(token: string, id: string): Promise<Response> {
    return rollbackRoute(apiRequest(`/api/imports/${id}/rollback`, { method: 'POST', token }), {
      params: Promise.resolve({ id }),
    });
  }

  it('User A ne peut pas consulter l’import de User B', async () => {
    const response = await getImport(userB.token, batchA.batch.id);

    expect(await expectErrorCode(response)).toBe('NOT_FOUND');
  });

  it('User A ne peut pas annuler l’import de User B', async () => {
    const response = await rollback(userB.token, batchA.batch.id);

    expect(await expectErrorCode(response)).toBe('NOT_FOUND');
    expect(tables.expense.rows).toHaveLength(2);
  });

  it('User B ne peut pas confirmer l’aperçu de User A', async () => {
    const preview = await previewImport(userA.token, CSV_RELEVE);

    const response = await confirmRoute(
      apiRequest('/api/imports/confirm', {
        method: 'POST',
        token: userB.token,
        body: { importId: preview.importId, acceptedRows: [2] },
      }),
    );

    expect(await expectErrorCode(response)).toBe('IMPORT_PREVIEW_EXPIRED');
  });

  it('les doublons ne sont jamais rapprochés entre utilisateurs', async () => {
    // User B importe exactement le même relevé : aucune de ses lignes ne doit
    // être considérée comme un doublon des dépenses de User A.
    const preview = await previewImport(userB.token, CSV_RELEVE);

    expect(preview.duplicates).toHaveLength(0);
    expect(preview.counts.valid).toBe(2);
  });

  it('supprime uniquement les dépenses du lot annulé', async () => {
    // User B importe le même relevé : ses dépenses ne doivent pas bouger.
    const previewB = await previewImport(userB.token, CSV_RELEVE);
    await confirmRoute(
      apiRequest('/api/imports/confirm', {
        method: 'POST',
        token: userB.token,
        body: { importId: previewB.importId, acceptedRows: [2, 3] },
      }),
    );

    expect(tables.expense.rows).toHaveLength(4);

    const response = await rollback(userA.token, batchA.batch.id);
    const result = await expectSuccess<{ deletedExpenseCount: number }>(response);

    expect(result.deletedExpenseCount).toBe(2);
    expect(tables.expense.rows).toHaveLength(2);
    expect(tables.expense.rows.every((row) => row['userId'] === userB.user.id)).toBe(true);
  });

  it('ne supprime jamais une dépense préexistante hors du lot', async () => {
    // Une dépense saisie manuellement, sans lot d'import.
    await tables.expense.create({
      data: {
        userId: userA.user.id,
        merchantRaw: 'BOULANGERIE',
        merchantNormalized: 'Boulangerie',
        amount: '4.50',
        currency: 'EUR',
        date: new Date('2026-01-06T00:00:00.000Z'),
        source: 'MANUAL',
        importBatchId: null,
        status: 'ACTIVE',
      },
    });

    await rollback(userA.token, batchA.batch.id);

    const restantes = tables.expense.rows.filter((row) => row['userId'] === userA.user.id);

    expect(restantes).toHaveLength(1);
    expect(restantes[0]?.['source']).toBe('MANUAL');
  });

  it('marque le lot comme annulé', async () => {
    await rollback(userA.token, batchA.batch.id);

    const response = await getImport(userA.token, batchA.batch.id);
    const body = await expectSuccess<{
      batch: { rolledBackAt: string | null; expenseCount: number };
    }>(response);

    expect(body.batch.rolledBackAt).not.toBeNull();
    expect(body.batch.expenseCount).toBe(0);
  });

  it('refuse d’annuler deux fois le même lot', async () => {
    await rollback(userA.token, batchA.batch.id);
    const second = await rollback(userA.token, batchA.batch.id);

    expect(await expectErrorCode(second)).toBe('IMPORT_BATCH_ALREADY_ROLLED_BACK');
  });

  it('refuse toute opération d’import sans session', async () => {
    const consultation = await getImport('token-invalide', batchA.batch.id);
    const annulation = await rollback('token-invalide', batchA.batch.id);

    expect(await expectErrorCode(consultation)).toBe('AUTH_UNAUTHORIZED');
    expect(await expectErrorCode(annulation)).toBe('AUTH_UNAUTHORIZED');
  });

  it('supprime le fichier source même lorsque l’analyse échoue', async () => {
    // Panne simulée au cœur du traitement : le bloc `finally` doit tout de même
    // supprimer le fichier temporaire (§3, §11).
    vi.spyOn(analyzeCsvModule, 'analyzeCsv').mockImplementation(() => {
      throw new Error('panne simulée pendant l’analyse');
    });

    const response = await previewRoute(authenticatedUpload(userA.token, CSV_RELEVE));
    const files = await readdir(importTempDirectory()).catch(() => []);

    expect(await expectErrorCode(response)).toBe('INTERNAL_ERROR');
    expect(files).toHaveLength(0);
  });
});
