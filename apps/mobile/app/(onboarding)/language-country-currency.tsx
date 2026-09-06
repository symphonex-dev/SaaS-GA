import {
  SUPPORTED_COUNTRIES,
  SUPPORTED_CURRENCIES,
  SUPPORTED_LOCALES,
  type CountryCode,
  type Currency,
  type Locale,
} from '@subscription-manager/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Screen } from '../../components/layout';
import { Button, OptionList, TextField } from '../../components/controls';
import { changeLanguage } from '../../lib/i18n';
import { useOnboarding } from '../../store/onboarding';

/**
 * Étape 2 sur 4 : langue, pays, devise
 * (`specs/ui-composants-mobile.md` §3, CLAUDE.md §4).
 *
 * Les trois réglages sont **indépendants** : changer la langue ne modifie ni le
 * pays ni la devise, et réciproquement. `language=fr` + `country=US` +
 * `currency=USD` est un cas parfaitement valide.
 */
const LOCALE_LABELS: Record<Locale, string> = { en: 'English', fr: 'Français', es: 'Español' };

const CURRENCY_LABELS: Record<Currency, string> = {
  EUR: 'Euro (EUR)',
  USD: 'US dollar (USD)',
  GBP: 'Pound sterling (GBP)',
  CAD: 'Canadian dollar (CAD)',
  AUD: 'Australian dollar (AUD)',
};

/** Pays les plus probables en tête ; la recherche donne accès à la liste ISO complète. */
const SUGGESTED_COUNTRIES: readonly CountryCode[] = [
  'FR',
  'BE',
  'CH',
  'ES',
  'GB',
  'US',
  'CA',
  'AU',
];

export default function LanguageCountryCurrency(): ReactNode {
  const { t } = useTranslation();
  const router = useRouter();
  const onboarding = useOnboarding();
  const [countryQuery, setCountryQuery] = useState('');

  const countryOptions = useMemo(() => {
    const query = countryQuery.trim().toUpperCase();
    const source =
      query.length === 0
        ? [...SUGGESTED_COUNTRIES, onboarding.country]
        : SUPPORTED_COUNTRIES.filter((code) => code.startsWith(query));

    return [...new Set(source)].slice(0, 30).map((code) => ({ value: code, label: code }));
  }, [countryQuery, onboarding.country]);

  return (
    <Screen
      title={t('onboarding.preferences.title')}
      subtitle={t('onboarding.preferences.subtitle')}
      showBack
      footer={
        <Button
          label={t('common.continue')}
          onPress={() => {
            router.push('/(auth)/privacy-consent');
          }}
        />
      }
    >
      <Text className="text-sm font-medium uppercase tracking-wide text-brand-600">
        {t('onboarding.welcome.step', { current: 2, total: 4 })}
      </Text>

      <OptionList
        label={t('onboarding.preferences.language')}
        options={SUPPORTED_LOCALES.map((locale) => ({
          value: locale,
          label: LOCALE_LABELS[locale],
        }))}
        selected={onboarding.language}
        onSelect={(locale) => {
          onboarding.setLanguage(locale);
          void changeLanguage(locale);
        }}
      />

      <View className="w-full gap-2 pt-2">
        <TextField
          label={t('onboarding.preferences.country')}
          hint={t('onboarding.preferences.countryHint')}
          value={countryQuery}
          onChangeText={setCountryQuery}
          autoCapitalize="none"
        />
        <OptionList
          label={t('onboarding.preferences.country')}
          options={countryOptions}
          selected={onboarding.country}
          onSelect={onboarding.setCountry}
        />
      </View>

      <View className="pt-2">
        <OptionList
          label={t('onboarding.preferences.currency')}
          hint={t('onboarding.preferences.currencyHint')}
          options={SUPPORTED_CURRENCIES.map((currency) => ({
            value: currency,
            label: CURRENCY_LABELS[currency],
          }))}
          selected={onboarding.currency}
          onSelect={onboarding.setCurrency}
        />
      </View>
    </Screen>
  );
}
