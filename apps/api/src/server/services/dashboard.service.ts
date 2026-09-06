import {
  annualizeRecurring,
  computePeriodChange,
  computeGoalProgress,
  isSupportedCurrency,
  moneyFromDecimal,
  sumMoney,
  zeroMoney,
  type AuthenticatedUser,
  type CategoryTotalDto,
  type Currency,
  type DashboardData,
  type ExpenseFrequency,
  type Money,
  type MoneyDto,
  type MonthlyPointDto,
  type PriceAlertDto,
  type RecurringSummaryDto,
  type UnconvertedCurrencyDto,
  type UpcomingExpenseDto,
} from '@subscription-manager/shared';
import type { ComparisonOffer, Expense, UserSavingsGoal } from '@prisma/client';

import { resolveCurrency } from '@/lib/finance/currency';
import { decimalToMoney, moneyToDto } from '@/lib/finance/money';
import { nextExpectedDate } from '@/lib/finance/projections';
import { annualSavingAgainstOffer, confirmedFromGoals } from '@/lib/finance/savings';
import { moneyFromDecimal as sharedMoneyFromDecimal } from '@subscription-manager/shared';
import {
  totalByCategory,
  totalForPeriod,
  type FinanceLine,
  type Period,
} from '@/lib/finance/totals';
import { detectRecurrence } from '@/lib/recurring/detect';
import { merchantComparisonKey } from '@/lib/merchant/normalize';
import { recurringMerchantKey } from '@/lib/recurring/normalize';
import { entitlementsFor } from '@/server/entitlements/entitlements';
import { dashboardRepository } from '@/server/repositories/dashboard.repository';
import {
  recurringRepository,
  type DetectionWithExpense,
} from '@/server/repositories/recurring.repository';
import { subscriptionRepository } from '@/server/repositories/subscription.repository';
import {
  groupByMerchant,
  toDetectionInput,
  type MerchantGroup,
} from '@/server/services/recurring-detection.service';

/**
 * Agrégation du tableau de bord (`specs/calculs-financiers.md` §8).
 *
 * Tout est calculé ici, en unités mineures entières : le mobile reçoit un DTO
 * prêt à afficher et ne recalcule **aucun** KPI (CLAUDE.md §5.1).
 *
 * Multi-devises : faute de fournisseur de taux en V1, seuls les montants
 * exprimés dans la devise de l'utilisateur entrent dans les KPI ; les autres
 * sont écartés et signalés dans `unconvertedCurrencies` — jamais additionnés
 * en silence (§7).
 */
const MONTHLY_EVOLUTION_MONTHS = 12;

function startOfMonth(date: Date): string {
  return `${date.toISOString().slice(0, 7)}-01`;
}

function endOfMonth(date: Date): string {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));

  return new Date(next.getTime() - 86_400_000).toISOString().slice(0, 10);
}

function monthPeriod(year: number, monthIndex: number): Period {
  const reference = new Date(Date.UTC(year, monthIndex, 1));

  return { from: startOfMonth(reference), to: endOfMonth(reference) };
}

function toFinanceLine(expense: Expense): FinanceLine | null {
  // La ligne conserve sa devise d'origine : le filtrage par devise cible est
  // fait par les fonctions de total, jamais par une conversion implicite (§7).
  const amount = decimalToMoney(expense.amount, resolveCurrency(expense.currency));

  if (amount === null) {
    return null;
  }

  return {
    id: expense.id,
    date: expense.date.toISOString().slice(0, 10),
    amount,
    category: expense.category,
    status: expense.status,
  };
}

function dtoOf(value: Money): MoneyDto {
  return moneyToDto(value);
}

/** Série récurrente retenue : un groupe de dépenses et sa détection. */
interface RecurringSeries {
  group: MerchantGroup;
  detection: DetectionWithExpense;
  frequency: ExpenseFrequency;
  latestExpense: Expense;
  latestAmount: Money;
  lastPaymentDate: string;
}

function buildSeries(
  groups: readonly MerchantGroup[],
  detections: readonly DetectionWithExpense[],
  options: { includeRejected?: boolean } = {},
): RecurringSeries[] {
  const byKey = new Map<string, DetectionWithExpense>();

  for (const detection of detections) {
    // Une détection rejetée par l'utilisateur ne compte dans aucun KPI (§8).
    // La page « Abonnements » les liste malgré tout, avec leur statut.
    if (detection.status === 'REJECTED' && options.includeRejected !== true) {
      continue;
    }

    byKey.set(
      `${recurringMerchantKey(detection.expense)}|${detection.expense.currency}`,
      detection,
    );
  }

  const series: RecurringSeries[] = [];

  for (const group of groups) {
    const detection = byKey.get(group.key);

    if (detection === undefined) {
      continue;
    }

    const latestExpense = [...group.expenses].sort(
      (left, right) => right.date.getTime() - left.date.getTime(),
    )[0];

    if (latestExpense === undefined) {
      continue;
    }

    const latestAmount = decimalToMoney(
      latestExpense.amount,
      resolveCurrency(latestExpense.currency),
    );

    if (latestAmount === null) {
      continue;
    }

    series.push({
      group,
      detection,
      frequency: detection.frequency,
      latestExpense,
      latestAmount,
      lastPaymentDate: latestExpense.date.toISOString().slice(0, 10),
    });
  }

  return series;
}

/**
 * « Abonnements actifs » (§8) : dépense `ACTIVE`, périodicité différente de
 * `ONCE`, et récurrence retenue par le moteur puis non rejetée.
 */
function isActiveSubscription(series: RecurringSeries, currency: Currency): boolean {
  return (
    series.latestExpense.status === 'ACTIVE' &&
    series.frequency !== 'ONCE' &&
    series.latestAmount.currency === currency
  );
}

function annualRecurringCost(series: readonly RecurringSeries[], currency: Currency): Money {
  const annualized: Money[] = [];

  for (const entry of series) {
    if (!isActiveSubscription(entry, currency)) {
      continue;
    }

    const annual = annualizeRecurring(entry.latestAmount, entry.frequency);

    // `IRREGULAR_RECURRING` n'a pas de facteur d'annualisation fixe : il est
    // exclu du coût annuel plutôt qu'estimé au jugé (§4).
    if (annual !== null) {
      annualized.push(annual);
    }
  }

  return sumMoney(annualized, currency);
}

function upcomingExpenses(
  series: readonly RecurringSeries[],
  currency: Currency,
): UpcomingExpenseDto[] {
  const upcoming: UpcomingExpenseDto[] = [];

  for (const entry of series) {
    if (!isActiveSubscription(entry, currency)) {
      continue;
    }

    const expectedDate = nextExpectedDate(
      entry.lastPaymentDate,
      entry.frequency,
      entry.detection.intervalDays,
    );

    if (expectedDate === null) {
      continue;
    }

    upcoming.push({
      expenseId: entry.latestExpense.id,
      merchant: entry.group.merchant,
      expectedDate,
      amount: dtoOf(entry.latestAmount),
      frequency: entry.frequency,
    });
  }

  return upcoming.sort((left, right) =>
    left.expectedDate === right.expectedDate
      ? left.merchant.localeCompare(right.merchant)
      : left.expectedDate < right.expectedDate
        ? -1
        : 1,
  );
}

/**
 * Alertes de hausse de prix : uniquement les hausses **confirmées** par le
 * moteur déterministe (`specs/moteur-recurrence.md` §5).
 *
 * Fonctionnalité réservée à l'offre Plus (`priceIncreaseAlerts`,
 * `specs/paiement-in-app.md` §2) : contrôle serveur, jamais côté mobile.
 */
function priceAlerts(
  series: readonly RecurringSeries[],
  currency: Currency,
  enabled: boolean,
): PriceAlertDto[] {
  if (!enabled) {
    return [];
  }

  const alerts: PriceAlertDto[] = [];

  for (const entry of series) {
    if (entry.latestAmount.currency !== currency) {
      continue;
    }

    const result = detectRecurrence(toDetectionInput(entry.group));
    const change = result.priceChange;

    if (change === null || !change.confirmed || change.absoluteChange.startsWith('-')) {
      continue;
    }

    const previousAmount = moneyFromDecimal(change.previousAmount, currency);
    const currentAmount = moneyFromDecimal(change.currentAmount, currency);

    if (previousAmount === null || currentAmount === null) {
      continue;
    }

    alerts.push({
      expenseId: entry.latestExpense.id,
      merchant: entry.group.merchant,
      previousAmount: dtoOf(previousAmount),
      currentAmount: dtoOf(currentAmount),
      increasePercentage: change.percentageChange,
    });
  }

  return alerts.sort((left, right) => left.merchant.localeCompare(right.merchant));
}

/**
 * Économies potentielles : comparaison de chaque abonnement actif aux offres
 * **encore vérifiées** de son pays, à devise et périodicité identiques.
 *
 * Rapprochement volontairement strict (nom de service normalisé identique) :
 * le comparateur complet relève de `specs/comparateur-et-assistant-ia.md`.
 * Aucune offre périmée n'entre dans le calcul, et une alternative plus chère ne
 * produit jamais d'économie négative (§6).
 */
function potentialSavings(
  series: readonly RecurringSeries[],
  offers: readonly ComparisonOffer[],
  currency: Currency,
): Money {
  const offersByKey = new Map<string, ComparisonOffer[]>();

  for (const offer of offers) {
    if (offer.currency !== currency) {
      continue;
    }

    const key = merchantComparisonKey(offer.serviceName);
    const bucket = offersByKey.get(key);

    if (bucket === undefined) {
      offersByKey.set(key, [offer]);
      continue;
    }

    bucket.push(offer);
  }

  const savings: Money[] = [];

  for (const entry of series) {
    if (!isActiveSubscription(entry, currency)) {
      continue;
    }

    const currentAnnual = annualizeRecurring(entry.latestAmount, entry.frequency);
    const candidates = offersByKey.get(merchantComparisonKey(entry.group.merchant)) ?? [];

    if (currentAnnual === null || candidates.length === 0) {
      continue;
    }

    let best: Money | null = null;

    for (const offer of candidates) {
      const price = decimalToMoney(offer.verifiedPrice, currency);

      if (price === null) {
        continue;
      }

      const offerAnnual = annualizeRecurring(
        price,
        offer.billingCycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
      );

      if (offerAnnual === null) {
        continue;
      }

      const saving = annualSavingAgainstOffer(currentAnnual, offerAnnual);

      if (saving !== null && (best === null || saving.amountMinor > best.amountMinor)) {
        best = saving;
      }
    }

    if (best !== null && best.amountMinor > 0n) {
      savings.push(best);
    }
  }

  return sumMoney(savings, currency);
}

function monthlyEvolution(
  lines: readonly FinanceLine[],
  currency: Currency,
  now: Date,
): MonthlyPointDto[] {
  const points: MonthlyPointDto[] = [];

  for (let offset = MONTHLY_EVOLUTION_MONTHS - 1; offset >= 0; offset -= 1) {
    const reference = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const period = monthPeriod(reference.getUTCFullYear(), reference.getUTCMonth());

    points.push({
      month: period.from.slice(0, 7),
      // Un mois sans dépense vaut zéro, jamais `null` (§9).
      amount: dtoOf(totalForPeriod({ lines, period, currency })),
    });
  }

  return points;
}

function unconvertedCurrencies(
  expenses: readonly Expense[],
  currency: Currency,
): UnconvertedCurrencyDto[] {
  const counts = new Map<string, number>();

  for (const expense of expenses) {
    if (expense.status !== 'ACTIVE' || expense.currency === currency) {
      continue;
    }

    counts.set(expense.currency, (counts.get(expense.currency) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([code, expenseCount]) => ({ currency: code, expenseCount }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

function primaryGoal(goals: readonly UserSavingsGoal[]): UserSavingsGoal | null {
  return goals.find((goal) => goal.status === 'ACTIVE') ?? goals[0] ?? null;
}

/**
 * Lignes de la page « Abonnements » (`specs/ui-composants-mobile.md` §6).
 *
 * Construites à partir des mêmes séries que le tableau de bord : coût annuel,
 * prochaine échéance et variation de prix sont calculés ici, jamais côté
 * mobile.
 */
function toSummary(entry: RecurringSeries, currency: Currency): RecurringSummaryDto {
  const annual = annualizeRecurring(entry.latestAmount, entry.frequency);
  const change = detectRecurrence(toDetectionInput(entry.group)).priceChange;

  const previousAmount =
    change === null ? null : sharedMoneyFromDecimal(change.previousAmount, currency);
  const currentAmount =
    change === null ? null : sharedMoneyFromDecimal(change.currentAmount, currency);

  return {
    detectionId: entry.detection.id,
    expenseId: entry.latestExpense.id,
    merchant: entry.group.merchant,
    category: entry.latestExpense.category,
    amount: dtoOf(entry.latestAmount),
    frequency: entry.frequency,
    annualCost: annual === null ? null : dtoOf(annual),
    lastPaymentDate: entry.lastPaymentDate,
    nextExpectedDate: nextExpectedDate(
      entry.lastPaymentDate,
      entry.frequency,
      entry.detection.intervalDays,
    ),
    confidence: entry.detection.confidenceScore,
    status: entry.detection.status,
    expenseStatus: entry.latestExpense.status,
    priceChange:
      change === null || !change.confirmed || previousAmount === null || currentAmount === null
        ? null
        : {
            previousAmount: dtoOf(previousAmount),
            currentAmount: dtoOf(currentAmount),
            percentage: change.percentageChange,
          },
  };
}

export const dashboardService = {
  /**
   * Liste des récurrences de l'utilisateur, y compris celles qu'il a rejetées
   * (le mobile les affiche avec le statut « ignoré » et permet de revenir
   * dessus).
   */
  async listSubscriptions(user: AuthenticatedUser): Promise<RecurringSummaryDto[]> {
    const currency = resolveCurrency(user.currency);

    const [expenses, detections] = await Promise.all([
      dashboardRepository.listExpenses(user.id),
      recurringRepository.listForUser(user.id),
    ]);

    return buildSeries(groupByMerchant(expenses), detections, { includeRejected: true })
      .filter((entry) => entry.latestAmount.currency === currency)
      .map((entry) => toSummary(entry, currency))
      .sort((left, right) => left.merchant.localeCompare(right.merchant));
  },

  /**
   * @param now instant de référence, injecté explicitement : le moteur ne doit
   *   jamais dépendre d'une horloge implicite pour rester testable.
   */
  async build(user: AuthenticatedUser, now: Date = new Date()): Promise<DashboardData> {
    const currency = resolveCurrency(user.currency);

    const [expenses, detections, goals, subscription] = await Promise.all([
      dashboardRepository.listExpenses(user.id),
      recurringRepository.listForUser(user.id),
      dashboardRepository.listSavingsGoals(user.id),
      subscriptionRepository.findByUserId(user.id),
    ]);

    const offers = await dashboardRepository.listVerifiedOffers(user.country, now);

    // Offre réellement en vigueur (`specs/paiement-in-app.md` §7) : jamais
    // déduite du seul champ `plan`, qui reste `PLUS` après une résiliation.
    const entitlements = entitlementsFor(subscription, now);

    const lines = expenses
      .map((expense) => toFinanceLine(expense))
      .filter((line): line is FinanceLine => line !== null);

    const currentPeriod = monthPeriod(now.getUTCFullYear(), now.getUTCMonth());
    const previousPeriod = monthPeriod(now.getUTCFullYear(), now.getUTCMonth() - 1);

    const monthlyExpenses = totalForPeriod({ lines, period: currentPeriod, currency });
    const previousMonthly = totalForPeriod({ lines, period: previousPeriod, currency });
    const change = computePeriodChange(monthlyExpenses, previousMonthly);

    const series = buildSeries(groupByMerchant(expenses), detections);
    const activeSeries = series.filter((entry) => isActiveSubscription(entry, currency));

    const goalInputs = goals.flatMap((goal) => {
      const goalCurrency = resolveCurrency(goal.currency);
      const targetAmount = decimalToMoney(goal.targetAmount, goalCurrency);
      const achievedAmount = decimalToMoney(goal.achievedAmount, goalCurrency);

      return targetAmount === null || achievedAmount === null
        ? []
        : [{ targetAmount, achievedAmount }];
    });

    const goal = primaryGoal(goals);
    const goalTarget =
      goal === null ? null : decimalToMoney(goal.targetAmount, resolveCurrency(goal.currency));
    const goalAchieved =
      goal === null ? null : decimalToMoney(goal.achievedAmount, resolveCurrency(goal.currency));
    const progress = computeGoalProgress(goalTarget, goalAchieved);

    const categories: CategoryTotalDto[] = totalByCategory({
      lines,
      period: currentPeriod,
      currency,
    }).map((entry) => ({
      category: entry.category,
      amount: dtoOf(entry.amount),
      percentage: entry.percentage,
    }));

    return {
      currency,
      period: currentPeriod,
      kpis: {
        monthlyExpenses: dtoOf(monthlyExpenses),
        activeSubscriptions: activeSeries.length,
        annualRecurringCost: dtoOf(annualRecurringCost(series, currency)),
        expensesToReview: expenses.filter((expense) => expense.status === 'TO_REVIEW').length,
      },
      upcomingExpenses: upcomingExpenses(series, currency),
      priceAlerts: priceAlerts(series, currency, entitlements.priceIncreaseAlerts),
      savings: {
        potential: dtoOf(potentialSavings(series, offers, currency)),
        // Aucune table `Saving` n'existe au schéma : le montant confirmé est
        // celui que l'utilisateur a lui-même déclaré atteint sur ses objectifs.
        confirmed: dtoOf(confirmedFromGoals(goalInputs, currency)),
        goalTarget: progress.target === null ? null : dtoOf(progress.target),
        goalAchieved: progress.achieved === null ? null : dtoOf(progress.achieved),
        goalProgressPercentage: progress.progressPercentage,
      },
      monthlyEvolution: monthlyEvolution(lines, currency, now),
      categories,
      monthOverMonth: {
        current: dtoOf(change.current),
        previous: dtoOf(change.previous),
        absoluteChange: dtoOf(change.absoluteChange),
        percentageChange: change.percentageChange,
        direction: change.direction,
      },
      unconvertedCurrencies: unconvertedCurrencies(expenses, currency),
      generatedAt: now.toISOString(),
    };
  },
};

/** Réexporté pour les tests de devise : la devise cible n'est jamais devinée. */
export function isUsableCurrency(value: string): value is Currency {
  return isSupportedCurrency(value);
}

export function zeroFor(currency: Currency): Money {
  return zeroMoney(currency);
}
