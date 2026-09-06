import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

/**
 * Briques de mise en page (`specs/ui-composants-mobile.md` §14).
 *
 * Règles tenues ici pour tous les écrans :
 *  - zones sécurisées gérées via `useSafeAreaInsets` (encoche, barre de gestes) ;
 *  - aucune dimension de mise en page en pixels fixes : flex, pourcentages et
 *    espacements relatifs uniquement ;
 *  - les tailles de police suivent le réglage système (aucun `allowFontScaling`
 *    désactivé), et les conteneurs s'étirent au lieu de tronquer.
 */
interface ScreenProps {
  children: ReactNode;
  /** Titre affiché en tête et annoncé comme en-tête aux lecteurs d'écran. */
  title?: string;
  subtitle?: string;
  /** Affiche une flèche de retour (écrans hors onglets). */
  showBack?: boolean;
  /** Contenu fixe en bas d'écran (bouton principal). */
  footer?: ReactNode;
  scroll?: boolean;
}

export function Screen({
  children,
  title,
  subtitle,
  showBack = false,
  footer,
  scroll = true,
}: ScreenProps): ReactNode {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();

  const header =
    title === undefined && !showBack ? null : (
      <View className="gap-2 px-5 pb-4">
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            className="self-start rounded-full px-3 py-2 active:opacity-60"
            onPress={() => {
              router.back();
            }}
          >
            <Text className="text-base font-medium text-brand-600">← {t('common.back')}</Text>
          </Pressable>
        ) : null}

        {title === undefined ? null : (
          <Text accessibilityRole="header" className="text-2xl font-bold leading-tight text-ink">
            {title}
          </Text>
        )}

        {subtitle === undefined ? null : (
          <Text className="text-base leading-snug text-ink-muted">{subtitle}</Text>
        )}
      </View>
    );

  const body = scroll ? (
    <ScrollView
      className="flex-1"
      contentContainerClassName="px-5 pb-8 gap-4"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View className="flex-1 gap-4 px-5">{children}</View>
  );

  return (
    <View
      className="flex-1 bg-surface-muted"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="pt-4">{header}</View>
      {body}
      {footer === undefined ? null : (
        <View className="border-t border-surface-border bg-surface px-5 py-4">{footer}</View>
      )}
    </View>
  );
}

export function Card({
  children,
  title,
  footer,
}: {
  children: ReactNode;
  title?: string;
  footer?: ReactNode;
}): ReactNode {
  return (
    <View className="w-full gap-3 rounded-2xl border border-surface-border bg-surface p-4">
      {title === undefined ? null : (
        <Text accessibilityRole="header" className="text-base font-semibold text-ink">
          {title}
        </Text>
      )}
      {children}
      {footer}
    </View>
  );
}

export function SectionTitle({ children }: { children: string }): ReactNode {
  return (
    <Text accessibilityRole="header" className="pt-2 text-lg font-semibold text-ink">
      {children}
    </Text>
  );
}

export function Row({
  label,
  value,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  accessibilityLabel?: string;
}): ReactNode {
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? `${label} : ${value}`}
      className="w-full flex-row flex-wrap items-baseline justify-between gap-2 py-1"
    >
      <Text className="shrink text-sm text-ink-muted">{label}</Text>
      <Text className="shrink text-right text-base font-medium text-ink">{value}</Text>
    </View>
  );
}

export function Divider(): ReactNode {
  return <View className="h-px w-full bg-surface-border" />;
}
