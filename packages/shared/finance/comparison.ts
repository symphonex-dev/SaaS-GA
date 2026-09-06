import { percentageOf } from './percentage';
import { subtractMoney, type Money } from './money';

/**
 * Variation période sur période (`specs/calculs-financiers.md` §5).
 *
 * `percentageChange` vaut `null` — jamais `"Infinity%"`, jamais `"0"` — quand
 * la période précédente est nulle : on ne peut pas exprimer une progression
 * relative à partir de rien.
 */
export type ChangeDirection = 'UP' | 'DOWN' | 'UNCHANGED';

export interface PeriodChange {
  current: Money;
  previous: Money;
  absoluteChange: Money;
  percentageChange: string | null;
  direction: ChangeDirection;
}

export function computePeriodChange(current: Money, previous: Money): PeriodChange {
  const absoluteChange = subtractMoney(current, previous);

  const direction: ChangeDirection =
    absoluteChange.amountMinor === 0n
      ? 'UNCHANGED'
      : absoluteChange.amountMinor > 0n
        ? 'UP'
        : 'DOWN';

  return {
    current,
    previous,
    absoluteChange,
    percentageChange: percentageOf(absoluteChange.amountMinor, previous.amountMinor),
    direction,
  };
}
