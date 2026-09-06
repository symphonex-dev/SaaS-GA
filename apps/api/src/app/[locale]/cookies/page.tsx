import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { LegalPage, List, Section } from '@/components/public/legal-page';
import { getClientEnv } from '@/lib/env/client';

/**
 * Page cookies.
 *
 * Elle peut être aussi courte parce que la règle « aucun tracker »
 * (CLAUDE.md §1) est réellement tenue : ni SDK publicitaire, ni analytics
 * comportemental, ni cookie sur ces pages. Il n'y a donc aucun consentement à
 * recueillir, et aucune bannière à afficher.
 */
export default async function CookiesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('cookies');
  const common = await getTranslations('common');
  const env = getClientEnv();

  return (
    <LegalPage
      title={t('title')}
      updatedAtLabel={common('lastUpdated', { date: env.NEXT_PUBLIC_LEGAL_UPDATED_AT })}
    >
      <Section title={t('shortTitle')}>
        <p>{t('shortBody')}</p>
      </Section>

      <Section title={t('siteTitle')}>
        <p>{t('siteBody')}</p>
      </Section>

      <Section title={t('appTitle')}>
        <p>{t('appIntro')}</p>
        <List items={[t('appItems.session'), t('appItems.preferences')]} />
        <p>{t('appOutro')}</p>
      </Section>
    </LegalPage>
  );
}
