import { z } from 'zod';

import { SUPPORTED_COUNTRIES } from '../constants/countries';
import { SUPPORTED_CURRENCIES } from '../constants/currencies';
import { SUPPORTED_LOCALES } from '../constants/locales';

/**
 * Primitives Zod partagées API ↔ mobile.
 *
 * Ces schémas décrivent les valeurs telles qu'elles transitent sur le réseau et
 * telles qu'elles sont écrites en base (`specs/schema-donnees.md`). Ils sont la
 * seule définition autorisée de ces règles : ne jamais les redéclarer ailleurs.
 */

/** Identifiant technique (cuid généré par Prisma). */
export const idSchema = z.string().min(1).max(64);

/** Date/heure ISO 8601 (`2026-01-31T23:59:59.000Z`). */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** Date calendaire ISO 8601 (`2026-01-31`). */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_ISO_DATE');

export const localeSchema = z.enum(SUPPORTED_LOCALES);
export const currencySchema = z.enum(SUPPORTED_CURRENCIES);
export const countrySchema = z.enum(SUPPORTED_COUNTRIES);

/**
 * Entier en unités mineures sérialisé en chaîne (`bigint` non JSON-safe).
 * Borné à 18 chiffres pour rester compatible avec `Decimal(19, 4)`.
 */
export const minorUnitsSchema = z.string().regex(/^-?(0|[1-9][0-9]{0,17})$/, 'INVALID_MINOR_UNITS');

export const positiveMinorUnitsSchema = minorUnitsSchema.refine(
  (value) => !value.startsWith('-') && value !== '0',
  'AMOUNT_MUST_BE_POSITIVE',
);

export const nonNegativeMinorUnitsSchema = minorUnitsSchema.refine(
  (value) => !value.startsWith('-'),
  'AMOUNT_MUST_BE_NON_NEGATIVE',
);

/**
 * Représentation décimale acceptée aux frontières de la base : au plus 15
 * chiffres avant la virgule et 4 après (`Decimal(19, 4)`).
 */
export const decimalStringSchema = z
  .string()
  .regex(/^-?(0|[1-9][0-9]{0,14})(\.[0-9]{1,4})?$/, 'INVALID_DECIMAL');

/** Montant transporté sur le réseau (voir `MoneyDto`). */
export const moneySchema = z.object({
  minorUnits: minorUnitsSchema,
  currency: currencySchema,
});

export const positiveMoneySchema = moneySchema.extend({
  minorUnits: positiveMinorUnitsSchema,
});

export const nonNegativeMoneySchema = moneySchema.extend({
  minorUnits: nonNegativeMinorUnitsSchema,
});

/**
 * Adresse e-mail : toute adresse valide au sens RFC est acceptée, sans aucune
 * liste blanche ni liste noire de domaines (CLAUDE.md §5.10). Normalisée en
 * minuscules avant stockage (`specs/schema-donnees.md` §3).
 */
export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** Politique de mot de passe (`specs/auth-comptes-rgpd.md` §2-3). */
export const passwordSchema = z.string().min(12).max(128);

/** URL absolue en HTTPS (liens officiels d'offres, liens d'affiliation). */
export const httpsUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => value.startsWith('https://'), 'URL_MUST_BE_HTTPS');

export const cursorPaginationSchema = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export type MoneyInput = z.infer<typeof moneySchema>;
export type CursorPaginationInput = z.infer<typeof cursorPaginationSchema>;
