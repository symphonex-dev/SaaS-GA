import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { LegalPage, Section } from '@/components/public/legal-page';
import { getClientEnv } from '@/lib/env/client';

/**
 * Page d'aide publique.
 *
 * Consultable sans compte : les boutiques exigent une page d'assistance
 * atteignable depuis leur fiche, donc avant toute installation.
 */
export default async function HelpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('help');
  const common = await getTranslations('common');
  const env = getClientEnv();

  return (
    <LegalPage
      title={t('title')}
      updatedAtLabel={common('lastUpdated', { date: env.NEXT_PUBLIC_LEGAL_UPDATED_AT })}
    >
      <Section title={t('importTitle')}>
        <p>{t('importBody')}</p>
      </Section>

      <Section title={t('formatsTitle')}>
        <p>{t('formatsBody')}</p>
      </Section>

      <Section title={t('detectionTitle')}>
        <p>{t('detectionBody')}</p>
      </Section>

      <Section title={t('currencyTitle')}>
        <p>{t('currencyBody')}</p>
      </Section>

      <Section title={t('billingTitle')}>
        <p>{t('billingBody')}</p>
      </Section>

      <Section title={t('deleteTitle')}>
        <p>{t('deleteBody')}</p>
      </Section>

      <p>{t('contactBody', { email: env.NEXT_PUBLIC_CONTACT_EMAIL })}</p>
    </LegalPage>
  );
}
