import type { Currency } from '../constants/currencies';

/** Date/heure sérialisée en ISO 8601 UTC (ex. `2026-01-31T23:59:59.000Z`). */
export type IsoDateTimeString = string;

/** Date calendaire sérialisée en ISO 8601 (ex. `2026-01-31`). */
export type IsoDateString = string;

/** Identifiant technique (cuid généré par Prisma). */
export type Id = string;

/**
 * Montant transporté sur le réseau.
 *
 * `minorUnits` est un entier en unités mineures (centimes) sérialisé en chaîne,
 * car `bigint` n'est pas JSON-safe. Le mobile ne fait que l'afficher : aucun
 * calcul financier n'est effectué côté client (CLAUDE.md §5.1 et §5.2).
 */
export interface MoneyDto {
  minorUnits: string;
  currency: Currency;
}

/** Enveloppe de pagination par curseur, utilisée par les listes. */
export interface PaginatedDto<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
