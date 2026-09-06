import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { LegalPage, Section } from '@/components/public/legal-page';
import { getClientEnv } from '@/lib/env/client';

/**
 * Conditions générales d'utilisation.
 *
 * Deux points y sont énoncés explicitement parce qu'ils engagent le produit :
 * l'application ne donne aucun conseil financier
 * (`specs/comparateur-et-assistant-ia.md` B.2), et la résiliation conserve
 * l'accès payant jusqu'à la fin de la période déjà réglée
 * (`specs/paiement-in-app.md` §6).
 */
export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('terms');
  const common = await getTranslations('common');
  const env = getClientEnv();

  return (
    <LegalPage
      title={t('title')}
      updatedAtLabel={common('lastUpdated', { date: env.NEXT_PUBLIC_LEGAL_UPDATED_AT })}
    >
      <p>{t('intro')}</p>

      <Section title={t('serviceTitle')}>
        <p>{t('serviceBody')}</p>
      </Section>

      <Section title={t('notAdviceTitle')}>
        <p>{t('notAdviceBody')}</p>
      </Section>

      <Section title={t('accountTitle')}>
        <p>{t('accountBody')}</p>
      </Section>

      <Section title={t('plansTitle')}>
        <p>{t('plansBody')}</p>
      </Section>

      <Section title={t('cancelTitle')}>
        <p>{t('cancelBody')}</p>
      </Section>

      <Section title={t('availabilityTitle')}>
        <p>{t('availabilityBody')}</p>
      </Section>

      <Section title={t('changesTitle')}>
        <p>{t('changesBody')}</p>
      </Section>
    </LegalPage>
  );
}
