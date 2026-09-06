import type { AuthenticatedSessionDto, ImportConfirmResultDto } from '@subscription-manager/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { POST as confirmRoute } from '@/app/api/imports/confirm/route';
import { POST as previewRoute } from '@/app/api/imports/preview/route';
import { resetRateLimits } from '@/lib/security/rate-limit';
import { resetPreviewStore } from '@/server/import/preview-store';

import { attachSubscription, createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { authenticatedUpload, CSV_RELEVE, previewImport } from '../helpers/import';
import { buildPdf } from '../helpers/pdf-fixture';
import { resetDatabase } from '../helpers/prisma-mock';

/**
 * Droits d'import par offre (`specs/import-releves.md` §5,
 * `specs/paiement-in-app.md` §2 et §7).
 *
 * Le contrôle est exclusivement serveur : aucune décision n'est laissée à
 * l'application mobile.
 */
describe('droits d’import selon l’offre', () => {
  let session: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();
    resetPreviewStore();

    session = await createUserWithSession({ email: 'free@example.com' });
  });

  function pdfReleve(): Buffer {
    return buildPdf(['RELEVE DE COMPTE - JANVIER 2026', '05/01/2026 NETFLIX.COM AMSTERDAM -13,49']);
  }

  async function importCsv(): Promise<ImportConfirmResultDto> {
    const preview = await previewImport(session.token, CSV_RELEVE);

    return expectSuccess<ImportConfirmResultDto>(
      await confirmRoute(
        apiRequest('/api/imports/confirm', {
          method: 'POST',
          token: session.token,
          body: { importId: preview.importId, acceptedRows: [2] },
        }),
      ),
    );
  }

  async function importPdf(): Promise<ImportConfirmResultDto> {
    const preview = await previewImport(session.token, pdfReleve(), {
      filename: 'releve.pdf',
      mimeType: 'application/pdf',
    });

    return expectSuccess<ImportConfirmResultDto>(
      await confirmRoute(
        apiRequest('/api/imports/confirm', {
          method: 'POST',
          token: session.token,
          body: {
            importId: preview.importId,
            acceptedRows: preview.rows.map((row) => row.rowNumber),
          },
        }),
      ),
    );
  }

  it('autorise l’essai PDF de l’offre Free une seule fois', async () => {
    await importPdf();

    const response = await previewRoute(
      authenticatedUpload(session.token, pdfReleve(), {
        filename: 'releve.pdf',
        mimeType: 'application/pdf',
      }),
    );

    expect(await expectErrorCode(response)).toBe('IMPORT_PDF_REQUIRES_PLUS');
  });

  it('n’impose aucune limite PDF à l’offre Plus', async () => {
    attachSubscription(session.user.id, { plan: 'PLUS', status: 'ACTIVE' });

    await importPdf();

    const response = await previewRoute(
      authenticatedUpload(session.token, pdfReleve(), {
        filename: 'releve.pdf',
        mimeType: 'application/pdf',
      }),
    );

    expect(response.status).toBe(201);
  });

  it('plafonne les imports CSV mensuels en Free', async () => {
    await importCsv();

    const response = await previewRoute(authenticatedUpload(session.token, CSV_RELEVE));

    expect(await expectErrorCode(response)).toBe('IMPORT_QUOTA_REACHED');
  });

  it('n’impose aucune limite CSV à l’offre Plus', async () => {
    attachSubscription(session.user.id, { plan: 'PLUS', status: 'ACTIVE' });

    await importCsv();

    const response = await previewRoute(authenticatedUpload(session.token, CSV_RELEVE));

    expect(response.status).toBe(201);
  });

  it('ne fait pas consommer de quota par un import annulé', async () => {
    const batch = await importCsv();

    // Le lot est annulé : l'utilisateur doit pouvoir réimporter.
    const { importRepository } = await import('@/server/repositories/import.repository');
    await importRepository.rollbackBatch(batch.batch.id, session.user.id, new Date());

    const response = await previewRoute(authenticatedUpload(session.token, CSV_RELEVE));

    expect(response.status).toBe(201);
  });
});
