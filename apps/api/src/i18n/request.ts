import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type Locale } from '@subscription-manager/shared';
import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';

import en from '@/locales/en.json';
import es from '@/locales/es.json';
import fr from '@/locales/fr.json';

/**
 * Internationalisation des pages publiques (CLAUDE.md §2.2).
 *
 * Traductions **statiques**, trois fichiers versionnés — jamais de texte
 * généré par IA à la volée (CLAUDE.md §5.6). Le référentiel de langues est
 * celui de `packages/shared` : les pages publiques et l'application mobile ne
 * peuvent pas diverger.
 */
const MESSAGES: Readonly<Record<Locale, typeof en>> = { en, fr, es };

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;

  // Une locale inconnue donne un 404, jamais un repli silencieux : une URL
  // légale doit désigner sans ambiguïté la version qu'elle affiche.
  if (requested === undefined || !isSupportedLocale(requested)) {
    notFound();
  }

  return { locale: requested, messages: MESSAGES[requested] };
});

export { DEFAULT_LOCALE };
