import {
  fromMinorUnits,
  type AuthenticatedUser,
  type Currency,
  type Locale,
} from '@subscription-manager/shared';

import { resolveCurrency } from '@/lib/finance/currency';
import { decimalToMoney } from '@/lib/finance/money';
import { dashboardRepository } from '@/server/repositories/dashboard.repository';
import { recurringRepository } from '@/server/repositories/recurring.repository';
import { dashboardService } from '@/server/services/dashboard.service';

/**
 * Contexte transmis à l'IA (`specs/comparateur-et-assistant-ia.md` B.5).
 *
 * RAG local minimal : **uniquement des faits déjà calculés** par les services
 * déterministes. Le modèle ne reçoit aucune donnée brute, aucun identifiant
 * technique, aucun secret, et rien qui appartienne à un autre utilisateur —
 * toutes les lectures ci-dessous sont filtrées par `user.id` (CLAUDE.md §5.3).
 *
 * La chaîne reste celle de B.1 :
 *   PostgreSQL → services déterministes → faits autorisés → IA → texte borné.
 */
export interface AiContext {
  locale: Locale;
  currency: string;
  month: string;
  monthlyTotal: string;
  previousMonthlyTotal: string;
  topCategories: Array<{ category: string; amount: string }>;
  newRecurringExpenses: Array<{ merchant: string; amount: string }>;
  priceIncreases: Array<{ merchant: string; previousAmount: string; currentAmount: string }>;
  cancelledExpenses: Array<{ merchant: string }>;
}

/**
 * Faits complets connus du serveur.
 *
 * `allowedExpenseIds` **n'est jamais transmis au modèle** : il sert uniquement
 * aux garde-fous, pour vérifier qu'une réponse ne référence pas une dépense
 * que le serveur n'a pas fournie (B.7).
 */
export interface AiFacts {
  context: AiContext;
  allowedExpenseIds: string[];
}

/** Nombre de catégories transmises : au-delà, le contexte n'apporte rien. */
const TOP_CATEGORIES = 5;

/** Bornes de volume : le contexte reste court et prévisible. */
const MAX_LIST_ENTRIES = 10;

function amountFromDto(value: { minorUnits: string; currency: Currency }): string {
  return fromMinorUnits(BigInt(value.minorUnits), value.currency);
}

function isSameMonth(date: Date, reference: Date): boolean {
  return (
    date.getUTCFullYear() === reference.getUTCFullYear() &&
    date.getUTCMonth() === reference.getUTCMonth()
  );
}

/**
 * Assemble les faits du mois courant.
 *
 * Aucun chiffre n'est calculé ici : les totaux, variations, catégories et
 * hausses proviennent tels quels du moteur financier et du moteur déterministe
 * de récurrence. Le rôle de ce module est de **choisir** quels faits sont
 * transmissibles, pas d'en produire.
 */
export async function buildAiFacts(
  user: AuthenticatedUser,
  now: Date = new Date(),
): Promise<AiFacts> {
  const currency = resolveCurrency(user.currency);

  const [dashboard, subscriptions, detections, expenses] = await Promise.all([
    dashboardService.build(user, now),
    dashboardService.listSubscriptions(user),
    recurringRepository.listForUser(user.id),
    dashboardRepository.listExpenses(user.id),
  ]);

  // Récurrences détectées pendant le mois courant : « nouveaux abonnements »
  // au sens de B.2, c'est-à-dire nouvellement identifiés par le moteur.
  const newDetectionIds = new Set(
    detections
      .filter((detection) => isSameMonth(detection.createdAt, now))
      .map((detection) => detection.id),
  );

  const newRecurring = subscriptions
    .filter(
      (subscription) =>
        newDetectionIds.has(subscription.detectionId) && subscription.status !== 'REJECTED',
    )
    .slice(0, MAX_LIST_ENTRIES);

  const cancelled = expenses
    .filter((expense) => expense.status === 'CANCELLED' && isSameMonth(expense.date, now))
    .slice(0, MAX_LIST_ENTRIES);

  const priceIncreases = dashboard.priceAlerts.slice(0, MAX_LIST_ENTRIES);

  const context: AiContext = {
    locale: user.language,
    currency,
    month: dashboard.period.from.slice(0, 7),
    monthlyTotal: amountFromDto(dashboard.monthOverMonth.current),
    previousMonthlyTotal: amountFromDto(dashboard.monthOverMonth.previous),
    topCategories: dashboard.categories.slice(0, TOP_CATEGORIES).map((entry) => ({
      category: entry.category,
      amount: amountFromDto(entry.amount),
    })),
    newRecurringExpenses: newRecurring.map((subscription) => ({
      merchant: subscription.merchant,
      amount: amountFromDto(subscription.amount),
    })),
    priceIncreases: priceIncreases.map((alert) => ({
      merchant: alert.merchant,
      previousAmount: amountFromDto(alert.previousAmount),
      currentAmount: amountFromDto(alert.currentAmount),
    })),
    // Le montant d'une dépense annulée n'apporte rien à l'explication : seul
    // le commerçant est transmis, conformément à B.5 (minimisation).
    cancelledExpenses: cancelled.flatMap((expense) => {
      const amount = decimalToMoney(expense.amount, currency);

      return amount === null ? [] : [{ merchant: expense.merchantNormalized }];
    }),
  };

  return {
    context,
    allowedExpenseIds: [
      ...newRecurring.map((subscription) => subscription.expenseId),
      ...priceIncreases.map((alert) => alert.expenseId),
      ...cancelled.map((expense) => expense.id),
    ],
  };
}
