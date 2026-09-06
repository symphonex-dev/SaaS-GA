import type { AuthenticatedSessionDto, RecurringDetectionDto } from '@subscription-manager/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { POST as confirmRoute } from '@/app/api/recurring/[id]/confirm/route';
import { POST as rejectRoute } from '@/app/api/recurring/[id]/reject/route';
import { PATCH as modifyRoute } from '@/app/api/recurring/[id]/route';
import { resetRateLimits } from '@/lib/security/rate-limit';
import { recurringDetectionService } from '@/server/services/recurring-detection.service';

import { createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/**
 * Détection persistée et validation utilisateur
 * (`specs/moteur-recurrence.md` §2, §8, §9).
 */
interface ExpenseSeed {
  userId: string;
  merchant: string;
  dates: readonly string[];
  amount?: string;
  status?: 'ACTIVE' | 'CANCELLED' | 'TO_REVIEW';
  currency?: string;
}

async function seedExpenses(seed: ExpenseSeed): Promise<void> {
  for (const date of seed.dates) {
    await tables.expense.create({
      data: {
        userId: seed.userId,
        merchantRaw: seed.merchant,
        merchantNormalized: seed.merchant,
        merchantOverride: null,
        amount: seed.amount ?? '13.49',
        currency: seed.currency ?? 'EUR',
        date: new Date(`${date}T00:00:00.000Z`),
        frequency: 'ONCE',
        category: 'OTHER',
        status: seed.status ?? 'ACTIVE',
        source: 'IMPORT',
        importBatchId: null,
      },
    });
  }
}

const MONTHLY_DATES = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05', '2026-05-05'];

describe('détection persistée et arbitrage utilisateur', () => {
  let session: AuthenticatedSessionDto;
  let other: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();

    session = await createUserWithSession({ email: 'recurrence@example.com' });
    other = await createUserWithSession({ email: 'voisin@example.com' });
  });

  function firstDetection(): { id: string } {
    const detection = tables.recurringDetection.rows[0] as { id: string } | undefined;

    if (detection === undefined) {
      throw new Error('Aucune détection produite.');
    }

    return detection;
  }

  function confirm(token: string, id: string): Promise<Response> {
    return confirmRoute(apiRequest(`/api/recurring/${id}/confirm`, { method: 'POST', token }), {
      params: Promise.resolve({ id }),
    });
  }

  function reject(token: string, id: string): Promise<Response> {
    return rejectRoute(apiRequest(`/api/recurring/${id}/reject`, { method: 'POST', token }), {
      params: Promise.resolve({ id }),
    });
  }

  function modify(token: string, id: string, body: unknown): Promise<Response> {
    return modifyRoute(apiRequest(`/api/recurring/${id}`, { method: 'PATCH', token, body }), {
      params: Promise.resolve({ id }),
    });
  }

  describe('production des détections', () => {
    it('crée une détection pour une série mensuelle', async () => {
      await seedExpenses({ userId: session.user.id, merchant: 'Netflix', dates: MONTHLY_DATES });

      const summary = await recurringDetectionService.refreshForUser(session.user.id);

      expect(summary.created).toBe(1);
      expect(tables.recurringDetection.rows[0]).toMatchObject({
        userId: session.user.id,
        frequency: 'MONTHLY',
        confidenceScore: 'HIGH',
        status: 'CONFIRMED',
      });
    });

    it('rattache la détection à la dépense la plus récente de la série', async () => {
      await seedExpenses({ userId: session.user.id, merchant: 'Netflix', dates: MONTHLY_DATES });
      await recurringDetectionService.refreshForUser(session.user.id);

      const detection = tables.recurringDetection.rows[0] as { expenseId: string };
      const anchor = tables.expense.rows.find((row) => row['id'] === detection.expenseId) as {
        date: Date;
      };

      expect(anchor.date.toISOString().slice(0, 10)).toBe('2026-05-05');
    });

    it('ne regroupe jamais deux commerçants différents', async () => {
      await seedExpenses({ userId: session.user.id, merchant: 'Netflix', dates: MONTHLY_DATES });
      await seedExpenses({
        userId: session.user.id,
        merchant: 'Spotify',
        dates: MONTHLY_DATES,
        amount: '11.99',
      });

      await recurringDetectionService.refreshForUser(session.user.id);

      expect(tables.recurringDetection.rows).toHaveLength(2);
    });

    it('exclut les transactions annulées', async () => {
      await seedExpenses({
        userId: session.user.id,
        merchant: 'Netflix',
        dates: MONTHLY_DATES,
        status: 'CANCELLED',
      });

      const summary = await recurringDetectionService.refreshForUser(session.user.id);

      expect(summary.created).toBe(0);
      expect(tables.recurringDetection.rows).toHaveLength(0);
    });

    it('n’intègre pas une transaction annulée à une série active', async () => {
      await seedExpenses({
        userId: session.user.id,
        merchant: 'Netflix',
        dates: ['2026-01-05', '2026-02-05'],
      });
      await seedExpenses({
        userId: session.user.id,
        merchant: 'Netflix',
        dates: ['2026-03-05'],
        status: 'CANCELLED',
      });

      const summary = await recurringDetectionService.refreshForUser(session.user.id);

      // Deux occurrences actives seulement : insuffisant pour une détection.
      expect(summary.created).toBe(0);
    });

    it('exclut un mouvement de sens inverse (remboursement)', async () => {
      await seedExpenses({ userId: session.user.id, merchant: 'Netflix', dates: MONTHLY_DATES });
      await tables.expense.create({
        data: {
          userId: session.user.id,
          merchantRaw: 'Netflix',
          merchantNormalized: 'Netflix',
          amount: '-13.49',
          currency: 'EUR',
          date: new Date('2026-06-05T00:00:00.000Z'),
          status: 'ACTIVE',
          source: 'IMPORT',
        },
      });

      await recurringDetectionService.refreshForUser(session.user.id);

      const detection = tables.recurringDetection.rows[0] as { amountVariance: string };

      // La série reste stable : le remboursement n'a pas élargi la variance.
      expect(detection.amountVariance).toBe('0.00');
    });

    it('n’analyse jamais les transactions d’un autre utilisateur', async () => {
      await seedExpenses({
        userId: session.user.id,
        merchant: 'Netflix',
        dates: ['2026-01-05', '2026-02-05'],
      });
      await seedExpenses({ userId: other.user.id, merchant: 'Netflix', dates: MONTHLY_DATES });

      const summary = await recurringDetectionService.refreshForUser(session.user.id);

      expect(summary.created).toBe(0);
    });

    it('ne crée pas de doublon lors d’une seconde exécution', async () => {
      await seedExpenses({ userId: session.user.id, merchant: 'Netflix', dates: MONTHLY_DATES });

      await recurringDetectionService.refreshForUser(session.user.id);
      const summary = await recurringDetectionService.refreshForUser(session.user.id);

      expect(summary.created).toBe(0);
      expect(summary.updated).toBe(1);
      expect(tables.recurringDetection.rows).toHaveLength(1);
    });
  });

  describe('arbitrage utilisateur', () => {
    beforeEach(async () => {
      await seedExpenses({ userId: session.user.id, merchant: 'Netflix', dates: MONTHLY_DATES });
      await recurringDetectionService.refreshForUser(session.user.id);
    });

    it('confirme une détection', async () => {
      const detection = firstDetection();
      const response = await confirm(session.token, detection.id);
      const body = await expectSuccess<{ detection: RecurringDetectionDto }>(response);

      expect(body.detection.status).toBe('CONFIRMED');
    });

    it('modifie la fréquence et passe en MODIFIED', async () => {
      const detection = firstDetection();
      const response = await modify(session.token, detection.id, { frequency: 'QUARTERLY' });
      const body = await expectSuccess<{ detection: RecurringDetectionDto }>(response);

      expect(body.detection.status).toBe('MODIFIED');
      expect(body.detection.frequency).toBe('QUARTERLY');
    });

    it('conserve la fréquence choisie par l’utilisateur lors des exécutions suivantes', async () => {
      const detection = firstDetection();
      await modify(session.token, detection.id, { frequency: 'QUARTERLY' });

      await recurringDetectionService.refreshForUser(session.user.id);

      expect(tables.recurringDetection.rows[0]).toMatchObject({
        frequency: 'QUARTERLY',
        status: 'MODIFIED',
      });
    });

    it('rejette une détection', async () => {
      const detection = firstDetection();
      const response = await reject(session.token, detection.id);
      const body = await expectSuccess<{ detection: RecurringDetectionDto }>(response);

      expect(body.detection.status).toBe('REJECTED');
    });

    it('ne ressuscite jamais une détection rejetée', async () => {
      const detection = firstDetection();
      await reject(session.token, detection.id);

      const summary = await recurringDetectionService.refreshForUser(session.user.id);

      expect(summary.created).toBe(0);
      expect(tables.recurringDetection.rows).toHaveLength(1);
      expect(tables.recurringDetection.rows[0]?.['status']).toBe('REJECTED');
    });

    it('refuse une fréquence hors référentiel', async () => {
      const detection = firstDetection();
      const response = await modify(session.token, detection.id, { frequency: 'DAILY' });

      expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
    });

    it('refuse ONCE, qui n’est pas une périodicité', async () => {
      const detection = firstDetection();
      const response = await modify(session.token, detection.id, { frequency: 'ONCE' });

      expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
    });
  });

  describe('enchaînement depuis l’import', () => {
    it('produit les détections juste après la confirmation d’un import', async () => {
      const { POST: confirmImport } = await import('@/app/api/imports/confirm/route');
      const { attachSubscription } = await import('../helpers/factories');
      const { previewImport } = await import('../helpers/import');
      const { resetPreviewStore } = await import('@/server/import/preview-store');

      resetPreviewStore();
      attachSubscription(session.user.id, { plan: 'PLUS', status: 'ACTIVE' });

      const csv = [
        'Date;Libellé;Montant',
        '05/01/2026;NETFLIX.COM AMSTERDAM;-13,49',
        '05/02/2026;NETFLIX.COM AMSTERDAM;-13,49',
        '05/03/2026;NETFLIX.COM AMSTERDAM;-13,49',
      ].join('\n');

      const preview = await previewImport(session.token, csv);

      await confirmImport(
        apiRequest('/api/imports/confirm', {
          method: 'POST',
          token: session.token,
          body: { importId: preview.importId, acceptedRows: [2, 3, 4] },
        }),
      );

      // La détection des récurrences est l'étape suivante du parcours principal :
      // elle est déclenchée sans action supplémentaire de l'utilisateur.
      expect(tables.recurringDetection.rows).toHaveLength(1);
      expect(tables.recurringDetection.rows[0]).toMatchObject({
        userId: session.user.id,
        frequency: 'MONTHLY',
      });
    });
  });

  describe('isolation', () => {
    beforeEach(async () => {
      await seedExpenses({ userId: session.user.id, merchant: 'Netflix', dates: MONTHLY_DATES });
      await recurringDetectionService.refreshForUser(session.user.id);
    });

    it('un autre utilisateur ne peut ni confirmer, ni modifier, ni rejeter', async () => {
      const detection = firstDetection();

      expect(await expectErrorCode(await confirm(other.token, detection.id))).toBe('NOT_FOUND');
      expect(
        await expectErrorCode(await modify(other.token, detection.id, { frequency: 'WEEKLY' })),
      ).toBe('NOT_FOUND');
      expect(await expectErrorCode(await reject(other.token, detection.id))).toBe('NOT_FOUND');

      expect(tables.recurringDetection.rows[0]?.['status']).toBe('CONFIRMED');
    });

    it('refuse toute action sans session valide', async () => {
      const detection = firstDetection();

      expect(await expectErrorCode(await confirm('token-invalide', detection.id))).toBe(
        'AUTH_UNAUTHORIZED',
      );
      expect(await expectErrorCode(await reject('token-invalide', detection.id))).toBe(
        'AUTH_UNAUTHORIZED',
      );
    });
  });
});
