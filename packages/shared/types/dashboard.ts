import type { Currency } from '../constants/currencies';
import type { ExpenseFrequency } from '../constants/enums';
import type { Id, IsoDateTimeString, MoneyDto } from './common';

/**
 * DTO du tableau de bord (`specs/calculs-financiers.md` §8).
 *
 * Tous les montants sont déjà calculés par `apps/api` : le mobile n'effectue
 * **aucun calcul de KPI** (CLAUDE.md §5.1). Ils transitent en unités mineures
 * sérialisées en chaîne (`MoneyDto`), la représentation `bigint` du moteur
 * n'étant pas JSON-safe — c'est la frontière de conversion décrite en §1.
 */
export interface DashboardKpis {
  monthlyExpenses: MoneyDto;
  activeSubscriptions: number;
  annualRecurringCost: MoneyDto;
  expensesToReview: number;
}

/**
 * Prochaine échéance attendue.
 *
 * Toujours une **prévision** (`lastPaymentDate + intervalle estimé`), jamais
 * une certitude : le libellé côté mobile doit le refléter (§8).
 */
export interface UpcomingExpenseDto {
  expenseId: Id;
  merchant: string;
  /** Date prévisionnelle ISO (`2026-06-05`). */
  expectedDate: string;
  amount: MoneyDto;
  frequency: ExpenseFrequency;
}

export interface PriceAlertDto {
  expenseId: Id;
  merchant: string;
  previousAmount: MoneyDto;
  currentAmount: MoneyDto;
  /** Pourcentage exact à deux décimales, calculé en unités mineures. */
  increasePercentage: string;
}

export interface DashboardSavingsDto {
  potential: MoneyDto;
  confirmed: MoneyDto;
  goalTarget: MoneyDto | null;
  goalAchieved: MoneyDto | null;
  /** Progression bornée `[0, 100]`, `null` si aucun objectif exploitable. */
  goalProgressPercentage: string | null;
}

export interface MonthlyPointDto {
  /** Mois civil au format `YYYY-MM`. */
  month: string;
  /** Un mois sans dépense vaut zéro — jamais `null` (§9). */
  amount: MoneyDto;
}

export interface CategoryTotalDto {
  category: string;
  amount: MoneyDto;
  /** Part du total, en pourcentage exact ; `null` si le total est nul. */
  percentage: string | null;
}

/**
 * Devises présentes dans les dépenses mais exclues des KPI faute de taux de
 * change (§7 : aucune conversion silencieuse).
 *
 * Ajout par rapport au DTO de la spec §8 : sans ce champ, un utilisateur ayant
 * des dépenses en plusieurs devises verrait des totaux muets et incomplets.
 */
export interface UnconvertedCurrencyDto {
  currency: string;
  expenseCount: number;
}

export interface DashboardData {
  /** Devise dans laquelle tous les montants ci-dessous sont exprimés. */
  currency: Currency;
  /** Période civile couverte par les KPI mensuels. */
  period: { from: string; to: string };
  kpis: DashboardKpis;
  upcomingExpenses: UpcomingExpenseDto[];
  priceAlerts: PriceAlertDto[];
  savings: DashboardSavingsDto;
  monthlyEvolution: MonthlyPointDto[];
  categories: CategoryTotalDto[];
  /** Variation du mois courant par rapport au mois précédent. */
  monthOverMonth: {
    current: MoneyDto;
    previous: MoneyDto;
    absoluteChange: MoneyDto;
    percentageChange: string | null;
    direction: 'UP' | 'DOWN' | 'UNCHANGED';
  };
  unconvertedCurrencies: UnconvertedCurrencyDto[];
  generatedAt: IsoDateTimeString;
}
