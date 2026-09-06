import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { LegalPage, List, Section } from '@/components/public/legal-page';
import { getClientEnv } from '@/lib/env/client';

/**
 * Page de contact.
 *
 * Volontairement **sans formulaire** : un formulaire collecterait des données
 * personnelles pour rien, alors qu'une adresse suffit (minimisation, RGPD).
 * L'adresse vient de la configuration publique, jamais codée en dur.
 */
export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('contact');
  const common = await getTranslations('common');
  const env = getClientEnv();

  return (
    <LegalPage
      title={t('title')}
      updatedAtLabel={common('lastUpdated', { date: env.NEXT_PUBLIC_LEGAL_UPDATED_AT })}
    >
      <p>
        <a href={`mailto:${env.NEXT_PUBLIC_CONTACT_EMAIL}`}>
          {t('intro', { email: env.NEXT_PUBLIC_CONTACT_EMAIL })}
        </a>
      </p>

      <Section title={t('topicsTitle')}>
        <p>{t('topicsIntro')}</p>
        <List
          items={[t('topicsItems.account'), t('topicsItems.device'), t('topicsItems.context')]}
        />
      </Section>

      <Section title={t('privacyTitle')}>
        <p>{t('privacyBody')}</p>
      </Section>

      <Section title={t('securityTitle')}>
        <p>{t('securityBody')}</p>
      </Section>
    </LegalPage>
  );
}
