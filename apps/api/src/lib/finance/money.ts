import {
  fromMinorUnits,
  parseMinorUnits,
  type Currency,
  type Money,
  type MoneyDto,
} from '@subscription-manager/shared';

/**
 * Frontière monétaire de `apps/api` (`specs/calculs-financiers.md` §1).
 *
 * Le calcul pur vit dans `packages/shared/finance` ; ce module ne fait que
 * convertir entre les trois représentations qui se rencontrent ici :
 *
 *   Prisma Decimal(19,4) ↔ bigint (unités mineures) ↔ MoneyDto (transport)
 *
 * Aucune arithmétique métier n'a lieu dans ce fichier.
 */

/** Décimales stockées en base : `Decimal(19, 4)` (`specs/schema-donnees.md`). */
const DATABASE_SCALE = 4;

/** Valeur lue depuis Prisma : `Decimal` expose `toString()`. */
export interface DecimalLike {
  toString(): string;
}

export function decimalStringToMinorUnits(value: string, currency: Currency): bigint | null {
  return parseMinorUnits(value, currency);
}

export function minorUnitsToDecimalString(minorUnits: bigint, currency: Currency): string {
  return fromMinorUnits(minorUnits, currency);
}

/** Convertit une colonne `Decimal` en `Money`; `null` si la valeur est illisible. */
export function decimalToMoney(value: DecimalLike, currency: Currency): Money | null {
  const amountMinor = parseMinorUnits(value.toString(), currency);

  return amountMinor === null ? null : { amountMinor, currency };
}

/**
 * Représentation destinée à la colonne `Decimal(19, 4)`.
 * Prisma accepte une chaîne : aucun `number` flottant n'est introduit.
 */
export function minorUnitsToDatabaseDecimal(minorUnits: bigint, currency: Currency): string {
  const decimal = fromMinorUnits(minorUnits, currency);
  const [integerPart = '0', fractionPart = ''] = decimal.split('.');

  return fractionPart.length >= DATABASE_SCALE
    ? decimal
    : `${integerPart}.${fractionPart.padEnd(DATABASE_SCALE, '0')}`;
}

export function moneyToDatabaseDecimal(value: Money): string {
  return minorUnitsToDatabaseDecimal(value.amountMinor, value.currency);
}

/** Sérialisation pour le transport : `bigint` n'est pas JSON-safe. */
export function moneyToDto(value: Money): MoneyDto {
  return { minorUnits: value.amountMinor.toString(), currency: value.currency };
}

export function absoluteMinorUnits(minorUnits: bigint): bigint {
  return minorUnits < 0n ? -minorUnits : minorUnits;
}
