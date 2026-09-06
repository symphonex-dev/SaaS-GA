import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { LegalPage, List, Section } from '@/components/public/legal-page';
import { getClientEnv } from '@/lib/env/client';

/**
 * Politique de confidentialité (`specs/auth-comptes-rgpd.md` §12).
 *
 * Contenu aligné sur ce que le code fait réellement : minimisation, suppression
 * immédiate du fichier importé, absence totale de tracker, périmètre borné de
 * l'IA, export et suppression accessibles depuis l'application.
 */
export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('privacy');
  const common = await getTranslations('common');
  const env = getClientEnv();

  return (
    <LegalPage
      title={t('title')}
      updatedAtLabel={common('lastUpdated', { date: env.NEXT_PUBLIC_LEGAL_UPDATED_AT })}
    >
      <p>{t('intro')}</p>

      <Section title={t('controllerTitle')}>
        <p>
          {t('controllerBody', {
            company: env.NEXT_PUBLIC_COMPANY_NAME,
            email: env.NEXT_PUBLIC_CONTACT_EMAIL,
          })}
        </p>
      </Section>

      <Section title={t('dataTitle')}>
        <p>{t('dataIntro')}</p>
        <List
          items={[
            t('dataItems.account'),
            t('dataItems.preferences'),
            t('dataItems.statements'),
            t('dataItems.subscription'),
          ]}
        />
      </Section>

      <Section title={t('noBankTitle')}>
        <p>{t('noBankIntro')}</p>
        <List
          items={[t('noBankItems.credentials'), t('noBankItems.card'), t('noBankItems.trackers')]}
        />
      </Section>

      <Section title={t('fileTitle')}>
        <p>{t('fileBody')}</p>
      </Section>

      <Section title={t('aiTitle')}>
        <p>{t('aiBody')}</p>
      </Section>

      <Section title={t('rightsTitle')}>
        <p>{t('rightsIntro')}</p>
        <List
          items={[
            t('rightsItems.access'),
            t('rightsItems.erase'),
            t('rightsItems.rectify'),
            t('rightsItems.portability'),
          ]}
        />
      </Section>

      <Section title={t('retentionTitle')}>
        <p>{t('retentionBody')}</p>
      </Section>

      <Section title={t('complaintTitle')}>
        <p>{t('complaintBody')}</p>
      </Section>
    </LegalPage>
  );
}
