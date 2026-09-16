import type { AuthenticatedSessionDto, DashboardData } from '@subscription-manager/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { GET as dashboardRoute } from '@/app/api/dashboard/route';
import { resetRateLimits } from '@/lib/security/rate-limit';
import { dashboardService } from '@/server/services/dashboard.service';
import { recurringDetectionService } from '@/server/services/recurring-detection.service';

import { attachSubscription, createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/**
 * Agrégation du tableau de bord (`specs/calculs-financiers.md` §8 et §9).
 *
 * L'instant de référence est injecté : aucun KPI ne dépend d'une horloge
 * implicite, les fixtures restent donc stables dans le temps.
 */
const NOW = new Date('2026-03-15T12:00:00.000Z');

interface ExpenseSeed {
  userId: string;
  merchant?: string;
  date: string;
  amount?: string;
  currency?: string;
  category?: string;
  status?: 'ACTIVE' | 'CANCELLED' | 'TO_REVIEW';
}

async function seedExpense(seed: ExpenseSeed): Promise<string> {
  const merchant = seed.merchant ?? 'Netflix';
  const row = (await tables.expense.create({
    data: {
      userId: seed.userId,
      merchantRaw: merchant,
      merchantNormalized: merchant,
      merchantOverride: null,
      amount: seed.amount ?? '10.00',
      currency: seed.currency ?? 'EUR',
      date: new Date(`${seed.date}T00:00:00.000Z`),
      category: seed.category ?? 'STREAMING',
      status: seed.status ?? 'ACTIVE',
      source: 'IMPORT',
      importBatchId: null,
    },
  })) as { id: string };

  return row.id;
}

describe('tableau de bord', () => {
  let session: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();

    session = await createUserWithSession({
      email: 'dashboard@example.com',
      country: 'FR',
      currency: 'EUR',
    });
  });

  async function build(): Promise<DashboardData> {
    return dashboardService.build(session.user, NOW);
  }

  describe('KPI mensuels', () => {
    beforeEach(async () => {
      // Janvier 100 €, février 120 €, mars 90 € (mois courant).
      await seedExpense({ userId: session.user.id, date: '2026-01-10', amount: '100.00' });
      await seedExpense({ userId: session.user.id, date: '2026-02-10', amount: '120.00' });
      await seedExpense({ userId: session.user.id, date: '2026-03-10', amount: '90.00' });
    });

    it('totalise le mois civil courant', async () => {
      const dashboard = await build();

      expect(dashboard.period).toEqual({ from: '2026-03-01', to: '2026-03-31' });
      expect(dashboard.kpis.monthlyExpenses).toEqual({ minorUnits: '9000', currency: 'EUR' });
    });

    it('calcule la variation mars/février : -25 %', async () => {
      const dashboard = await build();

      expect(dashboard.monthOverMonth.previous.minorUnits).toBe('12000');
      expect(dashboard.monthOverMonth.percentageChange).toBe('-25.00');
      expect(dashboard.monthOverMonth.direction).toBe('DOWN');
    });

    it('représente un mois sans dépense par zéro, jamais null', async () => {
      const dashboard = await build();
      const avril = dashboard.monthlyEvolution.find((point) => point.month === '2026-04');
      const decembre = dashboard.monthlyEvolution.find((point) => point.month === '2025-12');

      expect(dashboard.monthlyEvolution).toHaveLength(12);
      expect(avril).toBeUndefined();
      expect(decembre).toEqual({ month: '2025-12', amount: { minorUnits: '0', currency: 'EUR' } });
      expect(dashboard.monthlyEvolution.every((point) => point.amount.minorUnits !== null)).toBe(
        true,
      );
    });

    it('retrace les douze derniers mois civils, mois courant inclus', async () => {
      const dashboard = await build();

      expect(dashboard.monthlyEvolution[0]?.month).toBe('2025-04');
      expect(dashboard.monthlyEvolution[11]).toEqual({
        month: '2026-03',
        amount: { minorUnits: '9000', currency: 'EUR' },
      });
    });

    it('exclut les dépenses annulées et compte celles à vérifier', async () => {
      await seedExpense({
        userId: session.user.id,
        date: '2026-03-12',
        amount: '500.00',
        status: 'CANCELLED',
      });
      await seedExpense({
        userId: session.user.id,
        date: '2026-03-13',
        amount: '20.00',
        status: 'TO_REVIEW',
      });

      const dashboard = await build();

      expect(dashboard.kpis.monthlyExpenses.minorUnits).toBe('9000');
      expect(dashboard.kpis.expensesToReview).toBe(1);
    });

    it('répartit le mois courant par catégorie', async () => {
      await seedExpense({
        userId: session.user.id,
        date: '2026-03-11',
        amount: '10.00',
        merchant: 'Spotify',
        category: 'MUSIC',
      });

      const dashboard = await build();

      expect(dashboard.categories).toEqual([
        {
          category: 'STREAMING',
          amount: { minorUnits: '9000', currency: 'EUR' },
          percentage: '90.00',
        },
        { category: 'MUSIC', amount: { minorUnits: '1000', currency: 'EUR' }, percentage: '10.00' },
      ]);
    });
  });

  describe('abonnements et projections', () => {
    beforeEach(async () => {
      for (const date of ['2025-12-05', '2026-01-05', '2026-02-05', '2026-03-05']) {
        await seedExpense({ userId: session.user.id, date, amount: '13.49' });
      }

      await recurringDetectionService.refreshForUser(session.user.id);
    });

    it('compte les abonnements actifs et annualise leur coût', async () => {
      const dashboard = await build();

      expect(dashboard.kpis.activeSubscriptions).toBe(1);
      // 13,49 € × 12 = 161,88 €
      expect(dashboard.kpis.annualRecurringCost).toEqual({
        minorUnits: '16188',
        currency: 'EUR',
      });
    });

    it('annonce la prochaine échéance comme une prévision', async () => {
      const dashboard = await build();

      expect(dashboard.upcomingExpenses).toHaveLength(1);
      expect(dashboard.upcomingExpenses[0]).toMatchObject({
        merchant: 'Netflix',
        expectedDate: '2026-04-05',
        frequency: 'MONTHLY',
      });
    });

    it('ne compte plus un abonnement dont la récurrence a été rejetée', async () => {
      const detection = tables.recurringDetection.rows[0] as { status: string };
      detection.status = 'REJECTED';

      const dashboard = await build();

      expect(dashboard.kpis.activeSubscriptions).toBe(0);
      expect(dashboard.upcomingExpenses).toHaveLength(0);
      expect(dashboard.kpis.annualRecurringCost.minorUnits).toBe('0');
    });
  });

  describe('alertes de hausse de prix', () => {
    beforeEach(async () => {
      for (const [date, amount] of [
        ['2025-12-05', '9.99'],
        ['2026-01-05', '9.99'],
        ['2026-02-05', '11.99'],
        ['2026-03-05', '11.99'],
      ] as const) {
        await seedExpense({ userId: session.user.id, date, amount });
      }

      await recurringDetectionService.refreshForUser(session.user.id);
    });

    it('signale une hausse confirmée à un compte Plus', async () => {
      attachSubscription(session.user.id, { plan: 'PLUS', status: 'ACTIVE' });

      const dashboard = await build();

      expect(dashboard.priceAlerts).toHaveLength(1);
      expect(dashboard.priceAlerts[0]).toMatchObject({
        merchant: 'Netflix',
        previousAmount: { minorUnits: '999', currency: 'EUR' },
        currentAmount: { minorUnits: '1199', currency: 'EUR' },
        increasePercentage: '20.02',
      });
    });

    it('n’expose aucune alerte à un compte Free', async () => {
      const dashboard = await build();

      expect(dashboard.priceAlerts).toEqual([]);
    });
  });

  describe('économies et objectif', () => {
    it('borne la progression et distingue potentiel et confirmé', async () => {
      await tables.userSavingsGoal.create({
        data: {
          userId: session.user.id,
          targetAmount: '500.00',
          achievedAmount: '125.00',
          currency: 'EUR',
          status: 'ACTIVE',
        },
      });

      const dashboard = await build();

      expect(dashboard.savings.goalTarget).toEqual({ minorUnits: '50000', currency: 'EUR' });
      expect(dashboard.savings.goalProgressPercentage).toBe('25.00');
      expect(dashboard.savings.confirmed).toEqual({ minorUnits: '12500', currency: 'EUR' });
      // Aucune offre vérifiée ne correspond : le potentiel reste à zéro plutôt
      // que d'être estimé à partir d'une offre périmée.
      expect(dashboard.savings.potential).toEqual({ minorUnits: '0', currency: 'EUR' });
    });

    it('ne divise jamais par zéro sur un objectif nul', async () => {
      await tables.userSavingsGoal.create({
        data: {
          userId: session.user.id,
          targetAmount: '0.00',
          achievedAmount: '0.00',
          currency: 'EUR',
          status: 'ACTIVE',
        },
      });

      const dashboard = await build();

      expect(dashboard.savings.goalProgressPercentage).toBeNull();
    });

    it('renvoie un objectif absent comme null, sans planter', async () => {
      const dashboard = await build();

      expect(dashboard.savings.goalTarget).toBeNull();
      expect(dashboard.savings.goalAchieved).toBeNull();
      expect(dashboard.savings.goalProgressPercentage).toBeNull();
    });

    it('calcule une économie potentielle face à une offre encore vérifiée', async () => {
      for (const date of ['2025-12-05', '2026-01-05', '2026-02-05', '2026-03-05']) {
        await seedExpense({ userId: session.user.id, date, amount: '13.49' });
      }

      await recurringDetectionService.refreshForUser(session.user.id);

      await tables.comparisonOffer.create({
        data: {
          serviceName: 'Netflix',
          country: 'FR',
          verifiedPrice: '5.99',
          currency: 'EUR',
          billingCycle: 'MONTHLY',
          featuresIncluded: [],
          limits: {},
          commitmentDuration: null,
          directOfficialUrl: 'https://www.netflix.com/fr/',
          lastVerifiedAt: new Date('2026-03-01T00:00:00.000Z'),
          nextCheckAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      });

      const dashboard = await build();

      // (13,49 - 5,99) × 12 = 90,00 €
      expect(dashboard.savings.potential).toEqual({ minorUnits: '9000', currency: 'EUR' });
    });

    it('ignore une offre vérifiée il y a plus de 30 jours, même avant sa prochaine vérification', async () => {
      for (const date of ['2025-12-05', '2026-01-05', '2026-02-05', '2026-03-05']) {
        await seedExpense({ userId: session.user.id, date, amount: '13.49' });
      }

      await recurringDetectionService.refreshForUser(session.user.id);

      await tables.comparisonOffer.create({
        data: {
          serviceName: 'Netflix',
          country: 'FR',
          verifiedPrice: '5.99',
          currency: 'EUR',
          billingCycle: 'MONTHLY',
          featuresIncluded: [],
          limits: {},
          commitmentDuration: null,
          directOfficialUrl: 'https://www.netflix.com/fr/',
          // STALE : consultable dans le comparateur, jamais comptée (A.6).
          lastVerifiedAt: new Date('2026-01-15T00:00:00.000Z'),
          nextCheckAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      });

      const dashboard = await build();

      expect(dashboard.savings.potential.minorUnits).toBe('0');
    });

    it('ignore une offre dont la vérification est périmée', async () => {
      for (const date of ['2025-12-05', '2026-01-05', '2026-02-05', '2026-03-05']) {
        await seedExpense({ userId: session.user.id, date, amount: '13.49' });
      }

      await recurringDetectionService.refreshForUser(session.user.id);

      await tables.comparisonOffer.create({
        data: {
          serviceName: 'Netflix',
          country: 'FR',
          verifiedPrice: '5.99',
          currency: 'EUR',
          billingCycle: 'MONTHLY',
          featuresIncluded: [],
          limits: {},
          commitmentDuration: null,
          directOfficialUrl: 'https://www.netflix.com/fr/',
          lastVerifiedAt: new Date('2025-10-01T00:00:00.000Z'),
          nextCheckAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });

      const dashboard = await build();

      expect(dashboard.savings.potential.minorUnits).toBe('0');
    });
  });

  describe('multi-devises', () => {
    it('n’additionne jamais deux devises et signale celles écartées', async () => {
      await seedExpense({ userId: session.user.id, date: '2026-03-10', amount: '100.00' });
      await seedExpense({
        userId: session.user.id,
        date: '2026-03-11',
        amount: '100.00',
        currency: 'USD',
        merchant: 'Spotify',
      });

      const dashboard = await build();

      expect(dashboard.currency).toBe('EUR');
      expect(dashboard.kpis.monthlyExpenses.minorUnits).toBe('10000');
      expect(dashboard.unconvertedCurrencies).toEqual([{ currency: 'USD', expenseCount: 1 }]);
    });
  });

  describe('isolation et accès', () => {
    it('n’inclut jamais les dépenses d’un autre utilisateur', async () => {
      const other = await createUserWithSession({ email: 'autre@example.com' });

      await seedExpense({ userId: other.user.id, date: '2026-03-10', amount: '999.00' });
      await seedExpense({ userId: session.user.id, date: '2026-03-10', amount: '10.00' });

      const dashboard = await build();

      expect(dashboard.kpis.monthlyExpenses.minorUnits).toBe('1000');
    });

    it('refuse la route sans session valide', async () => {
      const response = await dashboardRoute(apiRequest('/api/dashboard'));

      expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
    });

    it('renvoie le DTO complet à un utilisateur authentifié', async () => {
      const response = await dashboardRoute(apiRequest('/api/dashboard', { token: session.token }));
      const dashboard = await expectSuccess<DashboardData>(response);

      expect(Object.keys(dashboard).sort()).toEqual(
        [
          'categories',
          'currency',
          'generatedAt',
          'kpis',
          'monthOverMonth',
          'monthlyEvolution',
          'period',
          'priceAlerts',
          'savings',
          'unconvertedCurrencies',
          'upcomingExpenses',
        ].sort(),
      );
    });

    it('sérialise tous les montants en unités mineures, jamais en flottant', async () => {
      await seedExpense({ userId: session.user.id, date: '2026-03-10', amount: '13.49' });

      const response = await dashboardRoute(apiRequest('/api/dashboard', { token: session.token }));
      const body = await response.text();

      // Un montant sérialisé en flottant apparaîtrait sous la forme `13.49`.
      expect(body).toContain('"minorUnits":"1349"');
      expect(body).not.toContain('13.49');
    });
  });
});
