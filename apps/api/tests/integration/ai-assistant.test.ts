import type {
  AiAnswerDto,
  AuthenticatedSessionDto,
  DashboardData,
} from '@subscription-manager/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as explainRoute } from '@/app/api/ai/explain-increase/route';
import { POST as recommendationRoute } from '@/app/api/ai/recommendation/route';
import { GET as quotaRoute, POST as summaryRoute } from '@/app/api/ai/summary/route';
import { GET as comparisonsRoute } from '@/app/api/comparisons/route';
import { GET as dashboardRoute } from '@/app/api/dashboard/route';
import { GET as recurringRoute } from '@/app/api/recurring/route';
import { resetServerEnvCache } from '@/lib/env/server';
import { resetRateLimits } from '@/lib/security/rate-limit';
import { buildAiFacts } from '@/server/ai/ai.context';
import { setAiProviderForTesting, type AiGenerationInput } from '@/server/ai/ai.provider';
import { createMockProvider, createScriptedProvider } from '@/server/ai/providers/mock.provider';
import { recurringDetectionService } from '@/server/services/recurring-detection.service';

import { MONTHLY_DATES, seedSeries } from '../helpers/comparison';
import { createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { resetDatabase } from '../helpers/prisma-mock';

/**
 * Assistant IA borné, bout en bout
 * (`specs/comparateur-et-assistant-ia.md` B.2, B.3, B.7, B.8, checklist B.9).
 */
const NOW = new Date('2026-06-15T12:00:00.000Z');

function post(path: string, token: string): Request {
  return apiRequest(path, { method: 'POST', token });
}

describe('assistant IA borné', () => {
  let session: AuthenticatedSessionDto;
  let other: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();

    process.env['AI_PROVIDER'] = 'mock';
    process.env['AI_MONTHLY_CREDITS_FREE'] = '3';
    resetServerEnvCache();
    setAiProviderForTesting(null);

    session = await createUserWithSession({ email: 'assistant@example.com', country: 'FR' });
    other = await createUserWithSession({ email: 'voisin@example.com', country: 'FR' });
  });

  afterEach(() => {
    setAiProviderForTesting(null);
    delete process.env['AI_PROVIDER'];
    delete process.env['AI_MONTHLY_CREDITS_FREE'];
    resetServerEnvCache();
  });

  it('exige une session valide sur les trois routes', async () => {
    for (const handler of [summaryRoute, explainRoute, recommendationRoute]) {
      const response = await handler(apiRequest('/api/ai/x', { method: 'POST' }));

      expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
    }
  });

  it('produit un résumé validé et consomme un crédit', async () => {
    const answer = await expectSuccess<AiAnswerDto>(
      await summaryRoute(post('/api/ai/summary', session.token)),
    );

    expect(answer.task).toBe('MONTHLY_SUMMARY');
    expect(answer.degraded).toBe(false);
    expect(answer.promptVersion).toBe('v1-bounded');
    expect(answer.quota.creditsUsed).toBe(1);
    expect(answer.answer.length).toBeGreaterThan(0);
  });

  it('expose exactement les trois usages autorisés', async () => {
    const tasks: string[] = [];

    for (const handler of [summaryRoute, explainRoute, recommendationRoute]) {
      const answer = await expectSuccess<AiAnswerDto>(
        await handler(post('/api/ai/x', session.token)),
      );

      tasks.push(answer.task);
    }

    expect(tasks).toEqual(['MONTHLY_SUMMARY', 'EXPLAIN_INCREASE', 'RECOMMENDATION']);
  });

  it('n’accepte aucun texte libre : le corps de requête est ignoré', async () => {
    // Aucun champ de question ouverte n'existe (le chatbot est hors périmètre).
    const answer = await expectSuccess<AiAnswerDto>(
      await summaryRoute(
        apiRequest('/api/ai/summary', {
          method: 'POST',
          token: session.token,
          body: { question: 'Dois-je investir en bourse ?' },
        }),
      ),
    );

    expect(answer.answer).not.toContain('bourse');
  });

  it('permet de remplacer le provider (B.3)', async () => {
    setAiProviderForTesting(createMockProvider());

    const first = await expectSuccess<AiAnswerDto>(
      await summaryRoute(post('/api/ai/summary', session.token)),
    );

    setAiProviderForTesting(
      createScriptedProvider(
        JSON.stringify({
          answer: 'Réponse issue d’un autre provider.',
          uncertainty: 'NONE',
          referencedExpenseIds: [],
        }),
      ),
    );

    const second = await expectSuccess<AiAnswerDto>(
      await summaryRoute(post('/api/ai/summary', session.token)),
    );

    expect(first.answer).not.toBe(second.answer);
    expect(second.answer).toBe('Réponse issue d’un autre provider.');
  });

  it('ne transmet jamais de secret ni de donnée d’un autre utilisateur', async () => {
    await seedSeries({ userId: other.user.id, merchant: 'SecretDuVoisin', dates: MONTHLY_DATES });
    await seedSeries({ userId: session.user.id, merchant: 'Netflix', dates: MONTHLY_DATES });
    await recurringDetectionService.refreshForUser(other.user.id);
    await recurringDetectionService.refreshForUser(session.user.id);

    const captured: AiGenerationInput[] = [];

    setAiProviderForTesting({
      name: 'capture',
      generate: (input) => {
        captured.push(input);

        return Promise.resolve({
          raw: JSON.stringify({ answer: 'ok', uncertainty: 'LOW', referencedExpenseIds: [] }),
        });
      },
    });

    await summaryRoute(post('/api/ai/summary', session.token));

    const payload = captured[0]?.serializedContext ?? '';

    expect(payload).toContain('Netflix');
    expect(payload).not.toContain('SecretDuVoisin');
    expect(payload).not.toContain(other.user.id);
    expect(payload).not.toContain(session.user.id);
    expect(payload).not.toContain(session.token);
    expect(payload).not.toContain('assistant@example.com');
    expect(payload).not.toContain('passwordHash');
  });

  it('construit des faits strictement cloisonnés par utilisateur', async () => {
    await seedSeries({ userId: other.user.id, merchant: 'SecretDuVoisin', dates: MONTHLY_DATES });
    await recurringDetectionService.refreshForUser(other.user.id);

    const facts = await buildAiFacts(session.user, NOW);

    expect(JSON.stringify(facts)).not.toContain('SecretDuVoisin');
    expect(facts.context.newRecurringExpenses).toEqual([]);
  });

  it('remplace une sortie hors schéma par la réponse générique, sans l’afficher', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    setAiProviderForTesting(createScriptedProvider('Je ne réponds pas en JSON.'));

    const answer = await expectSuccess<AiAnswerDto>(
      await summaryRoute(post('/api/ai/summary', session.token)),
    );

    expect(answer.degraded).toBe(true);
    expect(answer.uncertainty).toBe('HIGH');
    expect(answer.answer).not.toContain('Je ne réponds pas en JSON.');
    // Le rejet est journalisé, mais jamais avec le contenu rejeté.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('motif : SCHEMA');
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('JSON.');
  });

  it('remplace un contenu hors périmètre par la réponse générique', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    setAiProviderForTesting(
      createScriptedProvider(
        JSON.stringify({
          answer: 'You should invest your savings in an index fund.',
          uncertainty: 'NONE',
          referencedExpenseIds: [],
        }),
      ),
    );

    const answer = await expectSuccess<AiAnswerDto>(
      await recommendationRoute(post('/api/ai/recommendation', session.token)),
    );

    expect(answer.degraded).toBe(true);
    expect(answer.answer).not.toContain('index fund');
  });

  it('reste utilisable quand le provider échoue', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    setAiProviderForTesting(
      createScriptedProvider(() => Promise.reject(new Error('timeout réseau'))),
    );

    const answer = await expectSuccess<AiAnswerDto>(
      await summaryRoute(post('/api/ai/summary', session.token)),
    );

    expect(answer.degraded).toBe(true);
    expect(answer.answer.length).toBeGreaterThan(0);
  });

  it('signale l’IA indisponible sans consommer de crédit', async () => {
    process.env['AI_PROVIDER'] = 'none';
    resetServerEnvCache();

    const response = await summaryRoute(post('/api/ai/summary', session.token));

    expect(await expectErrorCode(response)).toBe('AI_UNAVAILABLE');
    expect(response.status).toBe(503);

    process.env['AI_PROVIDER'] = 'mock';
    resetServerEnvCache();

    const quota = await expectSuccess<{ quota: AiAnswerDto['quota'] }>(
      await quotaRoute(apiRequest('/api/ai/summary', { token: session.token })),
    );

    expect(quota.quota.creditsUsed).toBe(0);
  });

  it('bloque au-delà du quota mensuel', async () => {
    for (let index = 0; index < 3; index += 1) {
      await expectSuccess<AiAnswerDto>(await summaryRoute(post('/api/ai/summary', session.token)));
    }

    const response = await summaryRoute(post('/api/ai/summary', session.token));

    expect(await expectErrorCode(response)).toBe('AI_QUOTA_EXCEEDED');
  });

  it('laisse le reste de l’application intégralement fonctionnel sans IA', async () => {
    process.env['AI_PROVIDER'] = 'none';
    resetServerEnvCache();

    await seedSeries({ userId: session.user.id, merchant: 'Netflix', dates: MONTHLY_DATES });
    await recurringDetectionService.refreshForUser(session.user.id);

    const dashboard = await expectSuccess<DashboardData>(
      await dashboardRoute(apiRequest('/api/dashboard', { token: session.token })),
    );

    expect(dashboard.kpis.activeSubscriptions).toBe(1);

    const recurring = await expectSuccess<{ subscriptions: unknown[] }>(
      await recurringRoute(apiRequest('/api/recurring', { token: session.token })),
    );

    expect(recurring.subscriptions).toHaveLength(1);

    const comparisons = await expectSuccess<{ comparisons: unknown[] }>(
      await comparisonsRoute(apiRequest('/api/comparisons', { token: session.token })),
    );

    expect(comparisons.comparisons).toHaveLength(1);
  });

  it('applique un rate limit dédié, plus strict que l’API générale', async () => {
    // 30 appels par heure pour `ai:user`, contre 300 par minute pour l'API.
    for (let index = 0; index < 30; index += 1) {
      await summaryRoute(post('/api/ai/summary', session.token));
    }

    const response = await summaryRoute(post('/api/ai/summary', session.token));

    expect(await expectErrorCode(response)).toBe('RATE_LIMITED');
  });
});
