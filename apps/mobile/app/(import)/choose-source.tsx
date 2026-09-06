import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Screen } from '../../components/layout';
import { Notice } from '../../components/states';
import { useImportFlow } from '../../store/import';

/**
 * Choix de la source d'import (`specs/import-releves.md` §1,
 * `specs/ui-composants-mobile.md` §4).
 *
 * Le CSV est mis en avant en premier — c'est le parcours de référence, gratuit
 * et fiable. Le PDF vient en second, **toujours accompagné de sa mention de
 * compatibilité limitée** : jamais de promesse de compatibilité universelle.
 */
function SourceCard({
  title,
  description,
  onPress,
  emphasis,
}: {
  title: string;
  description: string;
  onPress: () => void;
  emphasis: boolean;
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      onPress={onPress}
      className={`w-full gap-2 rounded-2xl border p-5 active:opacity-80 ${emphasis ? 'border-brand-600 bg-brand-50' : 'border-surface-border bg-surface'}`}
    >
      <Text className="text-lg font-semibold text-ink">{title}</Text>
      <Text className="text-base leading-snug text-ink-muted">{description}</Text>
    </Pressable>
  );
}

export default function ChooseSource(): ReactNode {
  const { t } = useTranslation();
  const router = useRouter();
  const importFlow = useImportFlow();

  return (
    <Screen title={t('import.chooseSource.title')} showBack>
      <SourceCard
        emphasis
        title={t('import.chooseSource.csvTitle')}
        description={t('import.chooseSource.csvDescription')}
        onPress={() => {
          importFlow.reset();
          importFlow.setSource('CSV');
          router.push('/(import)/upload');
        }}
      />

      <SourceCard
        emphasis={false}
        title={t('import.chooseSource.pdfTitle')}
        description={t('import.chooseSource.pdfDescription')}
        onPress={() => {
          importFlow.reset();
          importFlow.setSource('PDF');
          router.push('/(import)/upload');
        }}
      />

      {/* Mention obligatoire avant tout import PDF (`specs/import-releves.md` §5). */}
      <Notice title={t('import.chooseSource.pdfDescription')} tone="warning" />
      <Notice title={t('import.chooseSource.pdfPlusRequired')} />
    </Screen>
  );
}
