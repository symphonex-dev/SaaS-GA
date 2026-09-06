import {
  percentageOf,
  subtractMoney,
  sumMoney,
  zeroMoney,
  type Currency,
  type ExpenseCategory,
  type Money,
} from '@subscription-manager/shared';

/**
 * Totaux (`specs/calculs-financiers.md` §3).
 *
 * Toutes les sommes se font en unités mineures : aucune ligne n'est arrondie
 * avant d'être sommée. Les fonctions sont pures — elles reçoivent des lignes
 * déjà chargées et filtrées par `userId` par le service appelant.
 */
export interface FinanceLine {
  id: string;
  /** Date calendaire ISO (`2026-01-05`). */
  date: string;
  amount: Money;
  category: ExpenseCategory;
  /** Une dépense annulée n'entre dans aucun total (§3). */
  status: 'ACTIVE' | 'CANCELLED' | 'TO_REVIEW';
}

/** Un remboursement se déduit du total de la période où il s'applique (§3). */
export interface RefundLine {
  id: string;
  date: string;
  amount: Money;
}

/** Une période est toujours explicite (§3) : jamais « les 365 derniers jours ». */
export interface Period {
  from: string;
  to: string;
}

export function isWithinPeriod(date: string, period: Period): boolean {
  return date >= period.from && date <= period.to;
}

/**
 * Seules les dépenses `ACTIVE` alimentent les totaux.
 *
 * `TO_REVIEW` est également écartée : une ligne que l'utilisateur n'a pas
 * validée ne doit pas gonfler un KPI présenté comme un fait.
 */
export function isCountable(line: FinanceLine): boolean {
  return line.status === 'ACTIVE';
}

export interface PeriodTotalInput {
  lines: readonly FinanceLine[];
  refunds?: readonly RefundLine[];
  period: Period;
  currency: Currency;
}

/**
 * `Σ(dépenses ACTIVE de la période) - Σ(remboursements applicables)`.
 *
 * En V1, les remboursements sont écartés dès l'import (`REFUND`, jamais
 * insérés comme dépense — `specs/import-releves.md` §6) : la liste est donc
 * normalement vide. Le paramètre existe pour que la règle de la spec reste
 * appliquée le jour où des remboursements seront enregistrés.
 */
export function totalForPeriod(input: PeriodTotalInput): Money {
  const expenses = input.lines
    .filter((line) => isCountable(line) && isWithinPeriod(line.date, input.period))
    .filter((line) => line.amount.currency === input.currency)
    .map((line) => line.amount);

  const refunds = (input.refunds ?? [])
    .filter((refund) => isWithinPeriod(refund.date, input.period))
    .filter((refund) => refund.amount.currency === input.currency)
    .map((refund) => refund.amount);

  return subtractMoney(sumMoney(expenses, input.currency), sumMoney(refunds, input.currency));
}

export interface CategoryTotal {
  category: ExpenseCategory;
  amount: Money;
  /** Part du total, en pourcentage exact ; `null` si le total est nul. */
  percentage: string | null;
}

/**
 * Totaux par catégorie, triés par montant décroissant puis par nom de
 * catégorie : l'ordre de sortie est déterministe.
 */
export function totalByCategory(input: PeriodTotalInput): CategoryTotal[] {
  const buckets = new Map<ExpenseCategory, bigint>();

  for (const line of input.lines) {
    if (!isCountable(line) || !isWithinPeriod(line.date, input.period)) {
      continue;
    }

    if (line.amount.currency !== input.currency) {
      continue;
    }

    buckets.set(line.category, (buckets.get(line.category) ?? 0n) + line.amount.amountMinor);
  }

  const total = [...buckets.values()].reduce((sum, value) => sum + value, 0n);

  return [...buckets.entries()]
    .map(([category, amountMinor]) => ({
      category,
      amount: { amountMinor, currency: input.currency },
      percentage: percentageOf(amountMinor, total),
    }))
    .sort((left, right) => {
      if (left.amount.amountMinor !== right.amount.amountMinor) {
        return left.amount.amountMinor > right.amount.amountMinor ? -1 : 1;
      }

      return left.category < right.category ? -1 : 1;
    });
}

/**
 * Total des abonnements : uniquement les lignes rattachées à une récurrence
 * retenue par le moteur (§3 — jamais les `ONCE` sans détection).
 */
export function totalSubscriptions(
  lines: readonly FinanceLine[],
  recurringLineIds: ReadonlySet<string>,
  currency: Currency,
): Money {
  const amounts = lines
    .filter((line) => isCountable(line) && recurringLineIds.has(line.id))
    .filter((line) => line.amount.currency === currency)
    .map((line) => line.amount);

  return amounts.length === 0 ? zeroMoney(currency) : sumMoney(amounts, currency);
}

/** Total d'une période sans remboursement — raccourci de lecture fréquent. */
export function totalOfLines(lines: readonly FinanceLine[], currency: Currency): Money {
  return sumMoney(
    lines
      .filter(isCountable)
      .filter((line) => line.amount.currency === currency)
      .map((line) => line.amount),
    currency,
  );
}
