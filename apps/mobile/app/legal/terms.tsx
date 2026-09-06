import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Screen } from '../../components/layout';

/**
 * Conditions d'utilisation (`specs/ui-composants-mobile.md` §12).
 * L'application n'est jamais présentée comme une banque ni comme un conseiller
 * financier (§3).
 */
const PARAGRAPHS = ['service', 'notAdvice', 'account', 'billing', 'termination'] as const;

export default function Terms(): ReactNode {
  const { t } = useTranslation();

  return (
    <Screen title={t('legal.terms.title')} showBack>
      <Card>
        {PARAGRAPHS.map((key) => (
          <Text key={key} className="pb-3 text-base leading-relaxed text-ink-muted">
            {t(`legal.terms.${key}`)}
          </Text>
        ))}
      </Card>
    </Screen>
  );
}
