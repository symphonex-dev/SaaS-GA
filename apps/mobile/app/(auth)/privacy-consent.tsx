import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Screen } from '../../components/layout';
import { Button, Checkbox } from '../../components/controls';
import { Notice } from '../../components/states';
import { useOnboarding } from '../../store/onboarding';

/**
 * Étape 3 sur 4 : consentement confidentialité
 * (`specs/ui-composants-mobile.md` §3, `specs/auth-comptes-rgpd.md` §6).
 *
 * Affiché juste avant l'inscription. Il énonce ce que l'application fait des
 * données — en particulier l'absence de tout tracker (CLAUDE.md §1) — et
 * rappelle qu'aucun mode invité n'existe.
 */
export default function PrivacyConsent(): ReactNode {
  const { t } = useTranslation();
  const router = useRouter();
  const onboarding = useOnboarding();

  return (
    <Screen
      title={t('onboarding.privacy.title')}
      showBack
      footer={
        <View className="w-full gap-3">
          <Button
            label={t('onboarding.privacy.accept')}
            disabled={!onboarding.privacyAccepted}
            accessibilityHint={t('onboarding.privacy.readPolicy')}
            onPress={() => {
              router.push('/(auth)/register');
            }}
          />
          <Button
            label={t('onboarding.privacy.readPolicy')}
            variant="ghost"
            onPress={() => {
              router.push('/legal/privacy');
            }}
          />
        </View>
      }
    >
      <Text className="text-sm font-medium uppercase tracking-wide text-brand-600">
        {t('onboarding.welcome.step', { current: 3, total: 4 })}
      </Text>

      <Notice title={t('onboarding.privacy.noTrackers')} tone="positive" />
      <Notice title={t('onboarding.privacy.fileDeleted')} />
      <Notice title={t('onboarding.privacy.exportable')} />
      <Notice title={t('onboarding.privacy.accountRequired')} tone="warning" />

      <View className="pt-2">
        <Checkbox
          label={t('onboarding.privacy.accept')}
          checked={onboarding.privacyAccepted}
          onToggle={() => {
            onboarding.setPrivacyAccepted(!onboarding.privacyAccepted);
          }}
        />
      </View>
    </Screen>
  );
}
