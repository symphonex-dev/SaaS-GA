import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Screen } from '../../components/layout';

/**
 * Cookies et traceurs (`specs/ui-composants-mobile.md` §12).
 *
 * Mentionne explicitement l'absence de tout SDK publicitaire et d'analytics
 * comportemental tiers (CLAUDE.md §1).
 */
const PARAGRAPHS = ['app', 'noAds', 'web'] as const;

export default function Cookies(): ReactNode {
  const { t } = useTranslation();

  return (
    <Screen title={t('legal.cookies.title')} showBack>
      <Card>
        {PARAGRAPHS.map((key) => (
          <Text key={key} className="pb-3 text-base leading-relaxed text-ink-muted">
            {t(`legal.cookies.${key}`)}
          </Text>
        ))}
      </Card>
    </Screen>
  );
}
