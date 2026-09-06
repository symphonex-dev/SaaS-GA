import { loginSchema, type LoginInput } from '@subscription-manager/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Screen } from '../../components/layout';
import { Button, TextField } from '../../components/controls';
import { ErrorState } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import { useLogin } from '../../lib/hooks';
import { useSession } from '../../store/session';

/**
 * Connexion (`specs/auth-comptes-rgpd.md` §4).
 *
 * Un e-mail inconnu et un mot de passe erroné produisent exactement le même
 * message : l'interface ne révèle jamais si un compte existe.
 */
export default function Login(): ReactNode {
  const { t } = useTranslation();
  const router = useRouter();
  const { startSession } = useSession();
  const login = useLogin();

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit((values) => {
    login.mutate(values, {
      onSuccess: (session) => {
        void startSession(session).then(() => {
          router.replace('/(tabs)/dashboard');
        });
      },
    });
  });

  return (
    <Screen
      title={t('auth.login.title')}
      showBack
      footer={
        <View className="w-full gap-3">
          <Button
            label={t('auth.login.submit')}
            loading={login.isPending}
            onPress={() => {
              void onSubmit();
            }}
          />
          <Button
            label={t('auth.login.noAccount')}
            variant="secondary"
            onPress={() => {
              router.push('/(onboarding)/language-country-currency');
            }}
          />
          <Button
            label={t('auth.login.forgot')}
            variant="ghost"
            onPress={() => {
              router.push('/(auth)/forgot-password');
            }}
          />
        </View>
      }
    >
      {login.isError ? <ErrorState message={errorMessage(login.error, t)} /> : null}

      <Controller
        control={form.control}
        name="email"
        render={({ field, fieldState }) => (
          <TextField
            label={t('auth.login.email')}
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
            label={t('auth.login.password')}
            value={field.value}
            onChangeText={field.onChange}
            secureTextEntry
            autoComplete="password"
            error={fieldState.error === undefined ? undefined : t('errors.VALIDATION_ERROR')}
          />
        )}
      />
    </Screen>
  );
}
