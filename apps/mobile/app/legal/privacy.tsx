import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Screen } from '../../components/layout';

/**
 * Politique de confidentialité (`specs/ui-composants-mobile.md` §12).
 *
 * Contenu statique traduit (en/fr/es), accessible **sans session** : il doit
 * être lisible depuis l'écran de consentement, avant toute création de compte,
 * et les boutiques exigent une URL publique équivalente (`ACTIONS_MANUELLES.md`).
 */
const PARAGRAPHS = ['intro', 'noTrackers', 'files', 'rights', 'retention'] as const;

export default function Privacy(): ReactNode {
  const { t } = useTranslation();

  return (
    <Screen title={t('legal.privacy.title')} showBack>
      <Card>
        {PARAGRAPHS.map((key) => (
          <Text key={key} className="pb-3 text-base leading-relaxed text-ink-muted">
            {t(`legal.privacy.${key}`)}
          </Text>
        ))}
      </Card>
    </Screen>
  );
}
