/**
 * Devises supportées (CLAUDE.md §4). La devise n'est JAMAIS déduite de la
 * langue ni du pays : elle est choisie explicitement par l'utilisateur.
 */
export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'CAD', 'AUD'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

/** Valeur par défaut de `User.currency` (voir schema.prisma, modèle `User`). */
export const DEFAULT_CURRENCY: Currency = 'EUR';

/**
 * Exposant des unités mineures (ISO 4217) : 10^exposant unités mineures pour
 * 1 unité majeure. Toutes les devises V1 sont en centièmes.
 *
 * Rappel CLAUDE.md §5.2 : tout calcul métier s'effectue en unités mineures
 * entières (`bigint`), jamais en `number` flottant.
 */
export const CURRENCY_MINOR_UNIT_EXPONENT: Readonly<Record<Currency, number>> = {
  EUR: 2,
  USD: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
};

/** Symbole d'affichage indicatif (le formatage réel passe par `Intl`). */
export const CURRENCY_SYMBOLS: Readonly<Record<Currency, string>> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  CAD: 'CA$',
  AUD: 'A$',
};

export function isSupportedCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}
