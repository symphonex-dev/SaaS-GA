import {
  computePeriodChange,
  type Currency,
  type Money,
  type PeriodChange,
} from '@subscription-manager/shared';

import { totalForPeriod, type FinanceLine, type Period, type RefundLine } from './totals';

/**
 * Comparaisons période sur période (`specs/calculs-financiers.md` §5).
 *
 * `percentageChange` est `null` quand la période précédente est nulle : la
 * spec interdit explicitement d'afficher « Infinity% ».
 */
export interface PeriodComparisonInput {
  lines: readonly FinanceLine[];
  refunds?: readonly RefundLine[];
  current: Period;
  previous: Period;
  currency: Currency;
}

export function comparePeriods(input: PeriodComparisonInput): PeriodChange {
  const current = totalForPeriod({
    lines: input.lines,
    ...(input.refunds === undefined ? {} : { refunds: input.refunds }),
    period: input.current,
    currency: input.currency,
  });

  const previous = totalForPeriod({
    lines: input.lines,
    ...(input.refunds === undefined ? {} : { refunds: input.refunds }),
    period: input.previous,
    currency: input.currency,
  });

  return computePeriodChange(current, previous);
}

export function compareAmounts(current: Money, previous: Money): PeriodChange {
  return computePeriodChange(current, previous);
}
