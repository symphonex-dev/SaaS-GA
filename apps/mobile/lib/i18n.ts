import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@subscription-manager/shared';
import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '../locales/en.json';
import es from '../locales/es.json';
import fr from '../locales/fr.json';

/**
 * Internationalisation (`specs/ui-composants-mobile.md` §13).
 *
 * Traductions **statiques** : trois fichiers versionnés, jamais de texte
 * généré par IA à la volée (CLAUDE.md §2.3). Aucun texte n'est codé en dur
 * dans un composant : tout passe par une clé.
 */
export const resources = {
  en: { translation: en },
  fr: { translation: fr },
  es: { translation: es },
};

/**
 * Langue proposée au premier lancement, déduite de l'appareil.
 *
 * Elle ne détermine **jamais** le pays ni la devise : ces trois réglages
 * restent indépendants (CLAUDE.md §4), et l'utilisateur les choisit
 * explicitement pendant l'onboarding.
 */
export function deviceLocale(): Locale {
  const [preferred] = Localization.getLocales();
  const code = preferred?.languageCode ?? DEFAULT_LOCALE;

  return (SUPPORTED_LOCALES as readonly string[]).includes(code)
    ? (code as Locale)
    : DEFAULT_LOCALE;
}

let initialized = false;

export function initI18n(initialLocale: Locale = deviceLocale()): typeof i18n {
  if (!initialized) {
    void i18n.use(initReactI18next).init({
      resources,
      lng: initialLocale,
      fallbackLng: DEFAULT_LOCALE,
      // React échappe déjà les valeurs interpolées.
      interpolation: { escapeValue: false },
      returnNull: false,
    });

    initialized = true;
  }

  return i18n;
}

export async function changeLanguage(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale);
}

/** Locale complète pour `Intl` (formatage des montants et des dates). */
export function intlLocale(locale: string): string {
  switch (locale) {
    case 'fr':
      return 'fr-FR';
    case 'es':
      return 'es-ES';
    default:
      return 'en-GB';
  }
}

export default i18n;
