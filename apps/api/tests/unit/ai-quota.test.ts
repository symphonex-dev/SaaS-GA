import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetServerEnvCache } from '@/lib/env/server';
import {
  AiQuotaExceededError,
  consumeAiCredit,
  creditsForPlan,
  currentPeriodStart,
  readAiQuota,
} from '@/server/ai/ai.quota';

import { createUserWithSession } from '../helpers/factories';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/**
 * Quotas IA (`specs/comparateur-et-assistant-ia.md` B.8, checklist B.9).
 *
 * Le point critique est l'atomicité : l'incrément est conditionnel côté base
 * (`credits_used < credits_granted` dans la clause `WHERE`), si bien qu'aucun
 * enchaînement d'appels ne peut faire dépasser le quota.
 */
const NOW = new Date('2026-06-15T12:00:00.000Z');

describe('quota IA', () => {
  let userId: string;

  beforeEach(async () => {
    resetDatabase();

    process.env['AI_MONTHLY_CREDITS_FREE'] = '3';
    process.env['AI_MONTHLY_CREDITS_PLUS'] = '30';
    resetServerEnvCache();

    const session = await createUserWithSession({ email: 'quota@example.com' });

    userId = session.user.id;
  });

  afterEach(() => {
    delete process.env['AI_MONTHLY_CREDITS_FREE'];
    delete process.env['AI_MONTHLY_CREDITS_PLUS'];
    resetServerEnvCache();
  });

  it('accorde les crédits de l’offre', () => {
    expect(creditsForPlan('FREE')).toBe(3);
    expect(creditsForPlan('PLUS')).toBe(30);
  });

  it('ancre la période au premier jour du mois, en UTC', () => {
    expect(currentPeriodStart(NOW).toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('ne consomme rien à la simple lecture', async () => {
    const quota = await readAiQuota(userId, 'FREE', NOW);

    expect(quota.creditsUsed).toBe(0);
    expect(quota.creditsRemaining).toBe(3);
    expect(tables.aiQuota.rows).toHaveLength(0);
  });

  it('consomme un crédit à chaque appel', async () => {
    expect((await consumeAiCredit(userId, 'FREE', NOW)).creditsUsed).toBe(1);
    expect((await consumeAiCredit(userId, 'FREE', NOW)).creditsRemaining).toBe(1);
  });

  it('refuse un appel au-delà du quota', async () => {
    for (let index = 0; index < 3; index += 1) {
      await consumeAiCredit(userId, 'FREE', NOW);
    }

    await expect(consumeAiCredit(userId, 'FREE', NOW)).rejects.toBeInstanceOf(AiQuotaExceededError);
    expect((await readAiQuota(userId, 'FREE', NOW)).creditsUsed).toBe(3);
  });

  it('ne dépasse jamais le quota, même sous appels concurrents', async () => {
    // 20 appels lancés ensemble pour 3 crédits : exactement 3 doivent aboutir.
    // Une implémentation « lire puis écrire » laisserait passer les 20, car
    // toutes les lectures précéderaient la première écriture.
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => consumeAiCredit(userId, 'FREE', NOW)),
    );

    const accepted = results.filter((result) => result.status === 'fulfilled');
    const refused = results.filter((result) => result.status === 'rejected');

    expect(accepted).toHaveLength(3);
    expect(refused).toHaveLength(17);
    expect(refused.every((result) => result.reason instanceof AiQuotaExceededError)).toBe(true);
    expect((await readAiQuota(userId, 'FREE', NOW)).creditsUsed).toBe(3);
  });

  it('remet les crédits à zéro au changement de mois', async () => {
    await consumeAiCredit(userId, 'FREE', NOW);
    await consumeAiCredit(userId, 'FREE', NOW);

    const nextMonth = new Date('2026-07-02T09:00:00.000Z');
    const quota = await consumeAiCredit(userId, 'FREE', nextMonth);

    expect(quota.periodStart).toBe('2026-07-01T00:00:00.000Z');
    expect(quota.creditsUsed).toBe(1);
  });

  it('suit un passage à Plus en cours de mois sans effacer la consommation', async () => {
    await consumeAiCredit(userId, 'FREE', NOW);
    await consumeAiCredit(userId, 'FREE', NOW);
    await consumeAiCredit(userId, 'FREE', NOW);

    const quota = await consumeAiCredit(userId, 'PLUS', NOW);

    expect(quota.creditsGranted).toBe(30);
    expect(quota.creditsUsed).toBe(4);
  });

  it('ne réinitialise pas une période déjà en cours à chaque appel', async () => {
    await consumeAiCredit(userId, 'FREE', NOW);
    await consumeAiCredit(userId, 'FREE', new Date('2026-06-20T08:00:00.000Z'));

    expect((await readAiQuota(userId, 'FREE', NOW)).creditsUsed).toBe(2);
  });
});
