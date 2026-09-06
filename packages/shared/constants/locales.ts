/**
 * Langues supportées (CLAUDE.md §4). Indépendantes du pays et de la devise :
 * `language=fr` + `country=US` + `currency=USD` est un cas valide.
 *
 * Les traductions sont statiques (fichiers de traduction), jamais générées par
 * IA à la volée (CLAUDE.md §2.3 et §5.6).
 */
export const SUPPORTED_LOCALES = ['en', 'fr', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Valeur par défaut de `User.language` (voir schema.prisma, modèle `User`). */
export const DEFAULT_LOCALE: Locale = 'en';

/** Libellé de la langue dans la langue elle-même (sélecteur de langue). */
export const LOCALE_NATIVE_LABELS: Readonly<Record<Locale, string>> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
};

/**
 * Nom affiché du produit, localisé (CLAUDE.md §1). L'identifiant technique
 * stable et non traduit reste `subscription-manager`.
 */
export const PRODUCT_NAME_BY_LOCALE: Readonly<Record<Locale, string>> = {
  en: 'Subscription Manager',
  fr: "Gestionnaire d'abonnements",
  es: 'Gestor de suscripciones',
};

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
