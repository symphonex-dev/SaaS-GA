import { SUPPORTED_LOCALES, type Locale } from '@subscription-manager/shared';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { getClientEnv } from '@/lib/env/client';
import { isSupportedLocale } from '@/i18n/request';

import '../globals.css';

/**
 * Pages publiques légales (CLAUDE.md §2.2).
 *
 * Strict minimum exigé par les boutiques et par le RGPD : confidentialité,
 * CGU, cookies, aide, contact. Pas de site marketing — le produit est
 * l'application mobile.
 *
 * Ces pages sont **statiques et sans JavaScript applicatif** : elles
 * n'affichent aucune donnée utilisateur, n'appellent aucune route protégée et
 * ne déposent aucun cookie. C'est ce qui permet de les servir sans bannière de
 * consentement.
 */
export function generateStaticParams(): Array<{ locale: Locale }> {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    return {};
  }

  const t = await getTranslations({ locale, namespace: 'common' });

  return {
    title: t('appName'),
    // Ces pages sont indexables : les boutiques et les utilisateurs doivent
    // pouvoir les atteindre. Elles ne contiennent aucune donnée personnelle.
    robots: { index: true, follow: true },
  };
}

const NAV_LINKS = ['privacy', 'terms', 'cookies', 'help', 'contact'] as const;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  // Permet le rendu statique de la page malgré l'usage de `next-intl`.
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'common' });
  const env = getClientEnv();

  return (
    <html lang={locale}>
      <body>
        <header>
          <nav aria-label={t('appName')}>
            <ul>
              {NAV_LINKS.map((link) => (
                <li key={link}>
                  <a href={`/${locale}/${link}`}>{t(`nav.${link}`)}</a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <NextIntlClientProvider>{children}</NextIntlClientProvider>

        <footer>
          <p>{t('footer', { company: env.NEXT_PUBLIC_COMPANY_NAME })}</p>
        </footer>
      </body>
    </html>
  );
}
