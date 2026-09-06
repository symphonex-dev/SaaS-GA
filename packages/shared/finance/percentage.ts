import { divideRounded, type Money } from './money';

/**
 * Pourcentages exacts (`specs/calculs-financiers.md` §3 et §5).
 *
 * Calculés en `bigint` puis formatés en chaîne : aucun `number` ne porte de
 * valeur financière. Le dénominateur nul renvoie toujours `null`, jamais
 * `Infinity`, jamais `0` — l'absence de base de comparaison doit rester
 * distinguable d'une variation nulle.
 */

/** Deux décimales : suffisant pour un affichage, exact dans le calcul. */
const PERCENTAGE_SCALE = 100n;

function formatScaled(scaled: bigint): string {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(3, '0');
  const formatted = `${digits.slice(0, digits.length - 2)}.${digits.slice(digits.length - 2)}`;

  return negative ? `-${formatted}` : formatted;
}

/**
 * `part / whole` exprimé en pourcentage, à deux décimales.
 * `null` si `whole` vaut zéro (§5).
 */
export function percentageOf(part: bigint, whole: bigint): string | null {
  const scaled = divideRounded(part * 100n * PERCENTAGE_SCALE, whole);

  return scaled === null ? null : formatScaled(scaled);
}

/** Variante `Money`, sans conversion de devise (les deux doivent concorder). */
export function percentageOfMoney(part: Money, whole: Money): string | null {
  if (part.currency !== whole.currency) {
    return null;
  }

  return percentageOf(part.amountMinor, whole.amountMinor);
}

/**
 * Progression bornée à `[0, 100]` pour l'affichage (§8), alors que le calcul
 * interne conserve la valeur exacte.
 */
export function clampPercentage(percentage: string | null): string | null {
  if (percentage === null) {
    return null;
  }

  const fraction = /^(-?)(\d+)\.(\d{2})$/.exec(percentage);

  if (fraction === null) {
    return percentage;
  }

  const [, sign = '', integerPart = '0', decimals = '00'] = fraction;
  const scaled = BigInt(`${sign === '-' ? '-' : ''}${integerPart}${decimals}`);

  if (scaled < 0n) {
    return '0.00';
  }

  return scaled > 10_000n ? '100.00' : percentage;
}
