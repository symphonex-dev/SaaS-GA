import { SUPPORTED_LOCALES, type Locale } from '@subscription-manager/shared';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Screen } from '../../components/layout';
import { Button, OptionList } from '../../components/controls';
import { changeLanguage } from '../../lib/i18n';

/**
 * Écran d'accueil (`specs/ui-composants-mobile.md` §3).
 *
 * Étape 1 sur 4 de l'onboarding. « Commencer » mène à l'onboarding puis à
 * l'inscription — **jamais** à un écran fonctionnel : il n'existe aucun mode
 * invité ni aperçu avant création de compte (CLAUDE.md §5.14).
 *
 * L'application n'est jamais présentée comme une banque ni comme un conseiller
 * financier.
 */
const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
};

export default function Welcome(): ReactNode {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  return (
    <Screen
      footer={
        <View className="w-full gap-3">
          <Button
            label={t('onboarding.welcome.getStarted')}
            onPress={() => {
              router.push('/(onboarding)/language-country-currency');
            }}
          />
          <Button
            label={t('onboarding.welcome.logIn')}
            variant="secondary"
            onPress={() => {
              router.push('/(auth)/login');
            }}
          />
        </View>
      }
    >
      <View className="w-full gap-4 pt-6">
        <Text className="text-sm font-medium uppercase tracking-wide text-brand-600">
          {t('onboarding.welcome.step', { current: 1, total: 4 })}
        </Text>

        {/* Nom de produit localisé : il suit la locale active, comme sur les
            fiches des boutiques (CLAUDE.md §1). */}
        <Text accessibilityRole="header" className="text-base font-semibold text-ink-muted">
          {t('common.appName')}
        </Text>

        <Text accessibilityRole="header" className="text-3xl font-bold leading-tight text-ink">
          {t('onboarding.welcome.title')}
        </Text>

        <Text className="text-base leading-relaxed text-ink-muted">
          {t('onboarding.welcome.subtitle')}
        </Text>
      </View>

      <View className="w-full pt-4">
        <OptionList
          label={t('onboarding.welcome.languageLabel')}
          hint={t('a11y.languageSelector')}
          options={SUPPORTED_LOCALES.map((locale) => ({
            value: locale,
            label: LOCALE_LABELS[locale],
          }))}
          selected={i18n.language as Locale}
          onSelect={(locale) => {
            // Changer la langue ne touche ni au pays ni à la devise (§13).
            void changeLanguage(locale);
          }}
        />
      </View>
    </Screen>
  );
}
