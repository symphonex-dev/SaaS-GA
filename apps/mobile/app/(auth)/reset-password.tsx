import { passwordSchema } from '@subscription-manager/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Button, TextField } from '../../components/controls';
import { Screen } from '../../components/layout';
import { ErrorState, Notice } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import { useResetPassword } from '../../lib/hooks';

/**
 * Réinitialisation de mot de passe (`specs/auth-comptes-rgpd.md` §5).
 *
 * Écran d'arrivée du lien profond `subscription-manager://reset-password?token=…`
 * envoyé par e-mail. Le token est à usage unique et à durée de vie courte : il
 * n'est ni stocké, ni journalisé, ni réutilisé — il ne fait que transiter vers
 * `POST /api/auth/reset-password`.
 *
 * Accessible sans session : c'est précisément le cas d'un utilisateur qui ne
 * peut plus se connecter. La garde de navigation autorise le groupe `(auth)`
 * pour cette raison (§3.1).
 */
const formSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'PASSWORD_MISMATCH',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof formSchema>;

export default function ResetPassword(): ReactNode {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const resetPassword = useResetPassword();

  // Le lien peut arriver tronqué (copier-coller partiel, client mail qui coupe).
  const token = typeof params.token === 'string' ? params.token.trim() : '';

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = form.handleSubmit((values) => {
    resetPassword.mutate({ token, password: values.password });
  });

  if (token.length === 0) {
    return (
      <Screen title={t('auth.resetPassword.title')} showBack>
        <Notice title={t('auth.resetPassword.missingToken')} tone="warning" />
        <Button
          label={t('auth.resetPassword.backToLogin')}
          variant="secondary"
          onPress={() => {
            router.replace('/(auth)/login');
          }}
        />
      </Screen>
    );
  }

  // Le changement de mot de passe révoque toutes les sessions : l'utilisateur
  // repart de l'écran de connexion, sans session implicite.
  if (resetPassword.isSuccess) {
    return (
      <Screen title={t('auth.resetPassword.title')}>
        <Notice title={t('auth.resetPassword.done')} tone="positive" />
        <Button
          label={t('auth.resetPassword.backToLogin')}
          onPress={() => {
            router.replace('/(auth)/login');
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('auth.resetPassword.title')}
      subtitle={t('auth.resetPassword.subtitle')}
      showBack
      footer={
        <View className="w-full gap-3">
          <Button
            label={t('auth.resetPassword.submit')}
            loading={resetPassword.isPending}
            onPress={() => {
              void onSubmit();
            }}
          />
          <Button
            label={t('auth.resetPassword.backToLogin')}
            variant="ghost"
            onPress={() => {
              router.replace('/(auth)/login');
            }}
          />
        </View>
      }
    >
      {resetPassword.isError ? <ErrorState message={errorMessage(resetPassword.error, t)} /> : null}

      <Controller
        control={form.control}
        name="password"
        render={({ field, fieldState }) => (
          <TextField
            label={t('auth.resetPassword.password')}
            hint={t('auth.resetPassword.passwordHint')}
            value={field.value}
            onChangeText={field.onChange}
            secureTextEntry
            autoComplete="new-password"
            error={fieldState.error === undefined ? undefined : t('errors.VALIDATION_ERROR')}
          />
        )}
      />

      <Controller
        control={form.control}
        name="confirmPassword"
        render={({ field, fieldState }) => (
          <TextField
            label={t('auth.resetPassword.confirmPassword')}
            value={field.value}
            onChangeText={field.onChange}
            secureTextEntry
            autoComplete="new-password"
            error={fieldState.error === undefined ? undefined : t('auth.resetPassword.mismatch')}
          />
        )}
      />
    </Screen>
  );
}
