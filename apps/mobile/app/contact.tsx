import type { ReactNode } from 'react';
import { Linking, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Screen } from '../components/layout';
import { Button } from '../components/controls';

/** Contact (`specs/ui-composants-mobile.md` §12). */
export default function Contact(): ReactNode {
  const { t } = useTranslation();
  const email = t('contact.email');

  return (
    <Screen title={t('contact.title')} showBack>
      <Card>
        <Text className="text-base leading-relaxed text-ink-muted">{t('contact.description')}</Text>
        <Text className="text-base font-medium text-ink">{email}</Text>
      </Card>

      <Button
        label={t('contact.openMail')}
        onPress={() => {
          void Linking.openURL(`mailto:${email}`);
        }}
      />
    </Screen>
  );
}
