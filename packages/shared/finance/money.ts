import { CURRENCY_MINOR_UNIT_EXPONENT, type Currency } from '../constants/currencies';

/**
 * Représentation canonique de l'argent (`specs/calculs-financiers.md` §1).
 *
 * Toute l'arithmétique métier se fait en **unités mineures entières**
 * (`bigint`) : aucun `number` JavaScript ne porte jamais une valeur monétaire
 * (CLAUDE.md §5.2). Les conversions n'ont lieu qu'aux frontières :
 *
 *   Prisma Decimal → toMinorUnits → calculs bigint → fromMinorUnits → affichage
 *
 * Corollaire respecté partout dans ce module : on ne
 * **jamais arrondit ligne à ligne avant de sommer** ; l'arrondi n'intervient
 * qu'au dernier stade (division, multiplication par un facteur, affichage).
 */
export interface Money {
  amountMinor: bigint;
  currency: Currency;
}

export class CurrencyMismatchError extends Error {
  constructor(left: Currency, right: Currency) {
    super(`Opération interdite entre ${left} et ${right} : une conversion explicite est requise.`);
    this.name = 'CurrencyMismatchError';
  }
}

export class InvalidMoneyError extends Error {
  constructor(value: string, currency: string) {
    super(`Montant « ${value} » invalide pour la devise ${currency}.`);
    this.name = 'InvalidMoneyError';
  }
}

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

function exponentFor(currency: string): number | null {
  return currency in CURRENCY_MINOR_UNIT_EXPONENT
    ? CURRENCY_MINOR_UNIT_EXPONENT[currency as Currency]
    : null;
}

/**
 * Conversion sûre d'une chaîne décimale en unités mineures.
 *
 * Renvoie `null` si la chaîne n'est pas un décimal valide, si la devise est
 * inconnue, ou si la valeur porte une décimale **significative** au-delà de ce
 * que la devise admet : arrondir silencieusement un montant reçu fausserait le
 * total sans que personne ne le voie. Les zéros de remplissage de l'échelle de
 * stockage (`Decimal(19, 4)`) sont en revanche acceptés — ils ne changent rien
 * à la valeur.
 */
export function parseMinorUnits(decimalString: string, currency: string): bigint | null {
  const exponent = exponentFor(currency);

  if (exponent === null) {
    return null;
  }

  const match = DECIMAL_PATTERN.exec(decimalString.trim());

  if (match === null) {
    return null;
  }

  const [, sign = '', integerPart = '0', fractionPart = ''] = match;

  // Au-dela de l'exposant de la devise, seuls des zeros sont acceptes : ils
  // n'apportent aucune information et proviennent de l'echelle de stockage
  // (`Decimal(19, 4)` represente 10,99 EUR par « 10.9900 »). Un chiffre non nul
  // en trop reste refuse : l'arrondir en silence fausserait le total.
  const significant = fractionPart.slice(0, exponent);
  const overflow = fractionPart.slice(exponent);

  if (/[1-9]/.test(overflow)) {
    return null;
  }

  const magnitude = BigInt(`${integerPart}${significant.padEnd(exponent, '0')}`);

  return sign === '-' ? -magnitude : magnitude;
}

/** Variante stricte, conforme à la signature de la spec §1. Lève si invalide. */
export function toMinorUnits(decimalString: string, currency: string): bigint {
  const minorUnits = parseMinorUnits(decimalString, currency);

  if (minorUnits === null) {
    throw new InvalidMoneyError(decimalString, currency);
  }

  return minorUnits;
}

/** Formatage exact des unités mineures — jamais via un flottant (spec §1). */
export function fromMinorUnits(amountMinor: bigint, currency: string): string {
  const exponent = exponentFor(currency);

  if (exponent === null) {
    throw new InvalidMoneyError(amountMinor.toString(), currency);
  }

  const negative = amountMinor < 0n;
  const digits = (negative ? -amountMinor : amountMinor).toString().padStart(exponent + 1, '0');
  const integerPart = digits.slice(0, digits.length - exponent);
  const fractionPart = digits.slice(digits.length - exponent);
  const formatted = exponent === 0 ? integerPart : `${integerPart}.${fractionPart}`;

  return negative ? `-${formatted}` : formatted;
}

export function money(amountMinor: bigint, currency: Currency): Money {
  return { amountMinor, currency };
}

export function zeroMoney(currency: Currency): Money {
  return { amountMinor: 0n, currency };
}

/** Construit un `Money` depuis une chaîne décimale ; `null` si invalide. */
export function moneyFromDecimal(decimalString: string, currency: Currency): Money | null {
  const amountMinor = parseMinorUnits(decimalString, currency);

  return amountMinor === null ? null : { amountMinor, currency };
}

export function formatMoney(value: Money): string {
  return fromMinorUnits(value.amountMinor, value.currency);
}

function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    // Interdiction explicite de la spec §7 : `100 USD + 100 EUR` n'a pas de
    // sens sans conversion tracée.
    throw new CurrencyMismatchError(left.currency, right.currency);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);

  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);

  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

/**
 * Somme d'une liste de montants.
 *
 * La devise est imposée par l'appelant : une liste vide renvoie zéro dans cette
 * devise plutôt que `null`, car « aucune dépense » vaut bien zéro (§9).
 */
export function sumMoney(values: readonly Money[], currency: Currency): Money {
  let total = 0n;

  for (const value of values) {
    assertSameCurrency({ amountMinor: 0n, currency }, value);
    total += value.amountMinor;
  }

  return { amountMinor: total, currency };
}

/**
 * Division entière arrondie au plus proche, à mi-chemin vers l'infini
 * (« half away from zero »). Règle fixe, donc reproductible.
 */
export function divideRounded(numerator: bigint, denominator: bigint): bigint | null {
  if (denominator === 0n) {
    return null;
  }

  const negative = numerator < 0n !== denominator < 0n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = (absoluteNumerator * 2n + absoluteDenominator) / (absoluteDenominator * 2n);

  return negative ? -quotient : quotient;
}

/**
 * Décompose une chaîne décimale en fraction exacte `numerator / denominator`,
 * pour multiplier ou diviser sans jamais passer par un flottant.
 */
export function decimalToFraction(
  value: string,
): { numerator: bigint; denominator: bigint } | null {
  const match = DECIMAL_PATTERN.exec(value.trim());

  if (match === null) {
    return null;
  }

  const [, sign = '', integerPart = '0', fractionPart = ''] = match;
  const numerator = BigInt(`${integerPart}${fractionPart}`);

  return {
    numerator: sign === '-' ? -numerator : numerator,
    denominator: 10n ** BigInt(fractionPart.length),
  };
}

/** Multiplication par un facteur décimal exact (`"1.5"`, `"12"`, `"0.20"`). */
export function multiplyMoney(value: Money, factor: string): Money | null {
  const fraction = decimalToFraction(factor);

  if (fraction === null) {
    return null;
  }

  const amountMinor = divideRounded(value.amountMinor * fraction.numerator, fraction.denominator);

  return amountMinor === null ? null : { amountMinor, currency: value.currency };
}

/**
 * Division par un diviseur décimal exact.
 * Renvoie `null` si le diviseur vaut zéro : l'absence de résultat doit rester
 * distinguable d'un résultat nul (§2).
 */
export function divideMoney(value: Money, divisor: string): Money | null {
  const fraction = decimalToFraction(divisor);

  if (fraction === null || fraction.numerator === 0n) {
    return null;
  }

  const amountMinor = divideRounded(value.amountMinor * fraction.denominator, fraction.numerator);

  return amountMinor === null ? null : { amountMinor, currency: value.currency };
}

/** Multiplication par un entier — cas courant de l'annualisation (§4). */
export function multiplyMoneyByInteger(value: Money, factor: bigint): Money {
  return { amountMinor: value.amountMinor * factor, currency: value.currency };
}

/** Division par un entier, arrondie ; `null` si le diviseur vaut zéro. */
export function divideMoneyByInteger(value: Money, divisor: bigint): Money | null {
  const amountMinor = divideRounded(value.amountMinor, divisor);

  return amountMinor === null ? null : { amountMinor, currency: value.currency };
}

export function absoluteMoney(value: Money): Money {
  return {
    amountMinor: value.amountMinor < 0n ? -value.amountMinor : value.amountMinor,
    currency: value.currency,
  };
}

export function isZeroMoney(value: Money): boolean {
  return value.amountMinor === 0n;
}

export function compareMoney(left: Money, right: Money): number {
  assertSameCurrency(left, right);

  if (left.amountMinor === right.amountMinor) {
    return 0;
  }

  return left.amountMinor < right.amountMinor ? -1 : 1;
}

/** Montant négatif ramené à zéro : une économie négative n'existe pas (§6). */
export function clampToZero(value: Money): Money {
  return value.amountMinor < 0n ? zeroMoney(value.currency) : value;
}
