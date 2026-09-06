import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Screen } from '../components/layout';

/** Aide (`specs/ui-composants-mobile.md` §12) — contenu statique traduit. */
const TOPICS = ['import', 'detection', 'currency', 'delete'] as const;

export default function Help(): ReactNode {
  const { t } = useTranslation();

  return (
    <Screen title={t('help.title')} showBack>
      {TOPICS.map((topic) => (
        <Card key={topic} title={t(`help.${topic}Title`)}>
          <Text className="text-base leading-relaxed text-ink-muted">{t(`help.${topic}Body`)}</Text>
        </Card>
      ))}
    </Screen>
  );
}
