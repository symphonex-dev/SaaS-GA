import { registerSchema, type RegisterInput } from '@subscription-manager/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Screen } from '../../components/layout';
import { Button, TextField } from '../../components/controls';
import { ErrorState } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import { useRegister } from '../../lib/hooks';
import { useOnboarding } from '../../store/onboarding';
import { useSession } from '../../store/session';

/**
 * Étape 4 sur 4 : création de compte
 * (`specs/ui-composants-mobile.md` §3, `specs/auth-comptes-rgpd.md` §2).
 *
 * Dernière étape obligatoire de l'onboarding : c'est elle qui ouvre l'accès à
 * l'application. Le formulaire réutilise `registerSchema` de
 * `packages/shared/validation` — la validation est donc strictement identique
 * côté client et côté serveur, y compris l'acceptation de **toute** adresse
 * e-mail valide, sans filtrage de domaine.
 */
export default function Register(): ReactNode {
  const { t } = useTranslation();
  const router = useRouter();
  const onboarding = useOnboarding();
  const { startSession } = useSession();
  const register = useRegister();

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      language: onboarding.language,
      country: onboarding.country,
      currency: onboarding.currency,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    register.mutate(values, {
      onSuccess: (session) => {
        void startSession(session).then(() => {
          // Dès la session obtenue, l'utilisateur va au premier import : il n'y
          // a pas d'étape d'onboarding après l'inscription (§6 de la spec auth).
          router.replace('/(import)/choose-source');
        });
      },
    });
  });

  return (
    <Screen
      title={t('auth.register.title')}
      subtitle={t('auth.register.subtitle')}
      showBack
      footer={
        <View className="w-full gap-3">
          <Button
            label={t('auth.register.submit')}
            loading={register.isPending}
            onPress={() => {
              void onSubmit();
            }}
          />
          <Button
            label={t('auth.register.haveAccount')}
            variant="ghost"
            onPress={() => {
              router.push('/(auth)/login');
            }}
          />
        </View>
      }
    >
      <Text className="text-sm font-medium uppercase tracking-wide text-brand-600">
        {t('onboarding.welcome.step', { current: 4, total: 4 })}
      </Text>

      {register.isError ? <ErrorState message={errorMessage(register.error, t)} /> : null}

      <Controller
        control={form.control}
        name="email"
        render={({ field, fieldState }) => (
          <TextField
            label={t('auth.register.email')}
            value={field.value}
            onChangeText={field.onChange}
            keyboardType="email-address"
            autoComplete="email"
            error={fieldState.error === undefined ? undefined : t('errors.VALIDATION_ERROR')}
          />
        )}
      />

      <Controller
        control={form.control}
        name="password"
        render={({ field, fieldState }) => (
          <TextField
            label={t('auth.register.password')}
            hint={t('auth.register.passwordHint')}
            value={field.value}
            onChangeText={field.onChange}
            secureTextEntry
            autoComplete="new-password"
            error={fieldState.error === undefined ? undefined : t('auth.register.passwordHint')}
          />
        )}
      />

      <View className="w-full gap-1 rounded-xl bg-surface p-4">
        <Text className="text-sm text-ink-muted">
          {`${t('onboarding.preferences.language')} · ${t('onboarding.preferences.country')} · ${t('onboarding.preferences.currency')}`}
        </Text>
        <Text className="text-base font-medium text-ink">
          {`${onboarding.language.toUpperCase()} · ${onboarding.country} · ${onboarding.currency}`}
        </Text>
      </View>
    </Screen>
  );
}
