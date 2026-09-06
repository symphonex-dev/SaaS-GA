import { requestPasswordResetSchema } from '@subscription-manager/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Screen } from '../../components/layout';
import { Button, TextField } from '../../components/controls';
import { ErrorState, Notice } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import { useRequestPasswordReset } from '../../lib/hooks';

/**
 * Mot de passe oublié (`specs/auth-comptes-rgpd.md` §5).
 *
 * La réponse est toujours la même, que le compte existe ou non : aucune
 * énumération d'adresses n'est possible depuis l'interface.
 */
export default function ForgotPassword(): ReactNode {
  const { t } = useTranslation();
  const router = useRouter();
  const requestReset = useRequestPasswordReset();

  const form = useForm<{ email: string }>({
    resolver: zodResolver(requestPasswordResetSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit((values) => {
    requestReset.mutate(values);
  });

  return (
    <Screen
      title={t('auth.forgotPassword.title')}
      subtitle={t('auth.forgotPassword.subtitle')}
      showBack
      footer={
        <View className="w-full gap-3">
          <Button
            label={t('auth.forgotPassword.submit')}
            loading={requestReset.isPending}
            onPress={() => {
              void onSubmit();
            }}
          />
          <Button
            label={t('auth.forgotPassword.backToLogin')}
            variant="ghost"
            onPress={() => {
              router.push('/(auth)/login');
            }}
          />
        </View>
      }
    >
      {requestReset.isError ? <ErrorState message={errorMessage(requestReset.error, t)} /> : null}
      {requestReset.isSuccess ? (
        <Notice title={t('auth.forgotPassword.sent')} tone="positive" />
      ) : null}

      <Controller
        control={form.control}
        name="email"
        render={({ field, fieldState }) => (
          <TextField
            label={t('auth.forgotPassword.email')}
            value={field.value}
            onChangeText={field.onChange}
            keyboardType="email-address"
            autoComplete="email"
            error={fieldState.error === undefined ? undefined : t('errors.VALIDATION_ERROR')}
          />
        )}
      />
    </Screen>
  );
}
