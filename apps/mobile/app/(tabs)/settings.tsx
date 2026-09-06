import {
  SUPPORTED_CURRENCIES,
  SUPPORTED_LOCALES,
  type Currency,
  type Locale,
} from '@subscription-manager/shared';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Divider, Screen, SectionTitle } from '../../components/layout';
import { Button, OptionList } from '../../components/controls';
import { ErrorState, LoadingState, Notice } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import { appVersion } from '../../lib/app-info';
import { useAccount, useLogout, useUpdatePreferences } from '../../lib/hooks';
import { changeLanguage } from '../../lib/i18n';
import { useSession } from '../../store/session';

/**
 * Paramètres (`specs/ui-composants-mobile.md` §11 et §13).
 *
 * Langue, pays et devise restent indépendants : modifier la langue n'entraîne
 * jamais de changement de pays ou de devise (CLAUDE.md §4). Les préférences
 * sont enregistrées sur le compte de la session — jamais via un identifiant
 * fourni par le client.
 */
const LOCALE_LABELS: Record<Locale, string> = { en: 'English', fr: 'Français', es: 'Español' };

const CURRENCY_LABELS: Record<Currency, string> = {
  EUR: 'Euro (EUR)',
  USD: 'US dollar (USD)',
  GBP: 'Pound sterling (GBP)',
  CAD: 'Canadian dollar (CAD)',
  AUD: 'Australian dollar (AUD)',
};

function SettingsLink({ label, onPress }: { label: string; onPress: () => void }): ReactNode {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      className="w-full flex-row items-center justify-between py-3.5 active:opacity-70"
    >
      <Text className="shrink text-base text-ink">{label}</Text>
      <Text className="text-base text-ink-subtle">›</Text>
    </Pressable>
  );
}

export default function Settings(): ReactNode {
  const { t } = useTranslation();
  const router = useRouter();
  const { endSession } = useSession();
  const account = useAccount();
  const updatePreferences = useUpdatePreferences();
  const logout = useLogout();

  if (account.isLoading) {
    return (
      <Screen title={t('settings.title')}>
        <LoadingState />
      </Screen>
    );
  }

  if (account.isError || account.data === undefined) {
    return (
      <Screen title={t('settings.title')}>
        <ErrorState
          message={errorMessage(account.error, t)}
          onRetry={() => {
            void account.refetch();
          }}
        />
      </Screen>
    );
  }

  const user = account.data;

  return (
    <Screen title={t('settings.title')}>
      <Card>
        <Text className="text-base font-medium text-ink">{user.email}</Text>
        <Text className="text-sm text-ink-muted">
          {`${t('settings.plan')} : ${user.tier === 'PLUS' ? t('settings.planPlus') : t('settings.planFree')}`}
        </Text>
      </Card>

      {updatePreferences.isSuccess ? (
        <Notice title={t('settings.preferencesSaved')} tone="positive" />
      ) : null}
      {updatePreferences.isError ? (
        <ErrorState message={errorMessage(updatePreferences.error, t)} />
      ) : null}

      <SectionTitle>{t('settings.preferences')}</SectionTitle>

      <Card>
        <OptionList
          label={t('settings.language')}
          options={SUPPORTED_LOCALES.map((locale) => ({
            value: locale,
            label: LOCALE_LABELS[locale],
          }))}
          selected={user.language}
          onSelect={(language) => {
            void changeLanguage(language);
            // Le pays et la devise sont renvoyés inchangés : changer la langue
            // ne les modifie jamais (§13).
            updatePreferences.mutate({
              language,
              country: user.country,
              currency: user.currency,
            });
          }}
        />
      </Card>

      <Card>
        <OptionList
          label={t('settings.currency')}
          options={SUPPORTED_CURRENCIES.map((currency) => ({
            value: currency,
            label: CURRENCY_LABELS[currency],
          }))}
          selected={user.currency}
          onSelect={(currency) => {
            updatePreferences.mutate({
              language: user.language,
              country: user.country,
              currency,
            });
          }}
        />
        <Text className="text-xs text-ink-subtle">
          {`${t('settings.country')} : ${user.country}`}
        </Text>
      </Card>

      <SectionTitle>{t('settings.plan')}</SectionTitle>
      <Card>
        <SettingsLink
          label={t('settings.upgrade')}
          onPress={() => {
            router.push('/billing/pricing');
          }}
        />
        <Divider />
        <SettingsLink
          label={t('settings.manageSubscription')}
          onPress={() => {
            router.push('/billing/manage-subscription');
          }}
        />
      </Card>

      <SectionTitle>{t('settings.account')}</SectionTitle>
      <Card>
        <SettingsLink
          label={t('settings.exportData')}
          onPress={() => {
            router.push('/account/export');
          }}
        />
        <Divider />
        <SettingsLink
          label={t('settings.deleteAccount')}
          onPress={() => {
            router.push('/account/delete-account');
          }}
        />
      </Card>

      <SectionTitle>{t('settings.legal')}</SectionTitle>
      <Card>
        <SettingsLink
          label={t('settings.privacy')}
          onPress={() => {
            router.push('/legal/privacy');
          }}
        />
        <Divider />
        <SettingsLink
          label={t('settings.terms')}
          onPress={() => {
            router.push('/legal/terms');
          }}
        />
        <Divider />
        <SettingsLink
          label={t('settings.cookies')}
          onPress={() => {
            router.push('/legal/cookies');
          }}
        />
        <Divider />
        <SettingsLink
          label={t('settings.help')}
          onPress={() => {
            router.push('/help');
          }}
        />
        <Divider />
        <SettingsLink
          label={t('settings.contact')}
          onPress={() => {
            router.push('/contact');
          }}
        />
      </Card>

      <View className="w-full pt-2">
        <Button
          label={t('auth.logout')}
          variant="secondary"
          loading={logout.isPending}
          onPress={() => {
            // La déconnexion réelle est la révocation serveur ; l'effacement du
            // token local vient ensuite (`specs/auth-comptes-rgpd.md` §4).
            logout.mutate(undefined, {
              onSettled: () => {
                void endSession().then(() => {
                  router.replace('/(onboarding)/welcome');
                });
              },
            });
          }}
        />
      </View>

      <Text className="pb-4 text-center text-xs text-ink-subtle">
        {`${t('common.appName')} · ${t('settings.version', { version: appVersion() })}`}
      </Text>
    </Screen>
  );
}
