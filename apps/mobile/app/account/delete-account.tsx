import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Screen } from '../../components/layout';
import { Button, TextField } from '../../components/controls';
import { ErrorState, Notice } from '../../components/states';
import { errorCode, errorMessage } from '../../lib/errors';
import { useDeleteAccount } from '../../lib/hooks';
import { useSession } from '../../store/session';

/**
 * Suppression de compte (`specs/ui-composants-mobile.md` §11,
 * `specs/auth-comptes-rgpd.md` §9).
 *
 * Si le serveur refuse parce qu'un abonnement payant est encore actif et non
 * résilié, l'écran affiche **explicitement** le blocage et propose un lien
 * direct vers la gestion d'abonnement : résilier débloque la suppression
 * immédiatement, sans attendre la fin de la période déjà payée (CLAUDE.md §5.9).
 */
const CONFIRMATION_VALUE = 'DELETE_MY_ACCOUNT';

export default function DeleteAccount(): ReactNode {
  const { t } = useTranslation();
  const router = useRouter();
  const { endSession } = useSession();
  const deleteAccount = useDeleteAccount();
  const [confirmation, setConfirmation] = useState('');

  const blocked = errorCode(deleteAccount.error) === 'ACCOUNT_DELETION_BLOCKED_ACTIVE_SUBSCRIPTION';
  const canSubmit = confirmation.trim() === CONFIRMATION_VALUE;

  return (
    <Screen
      title={t('account.delete.title')}
      showBack
      footer={
        <Button
          label={t('account.delete.submit')}
          variant="danger"
          disabled={!canSubmit}
          loading={deleteAccount.isPending}
          onPress={() => {
            deleteAccount.mutate(undefined, {
              onSuccess: () => {
                void endSession().then(() => {
                  router.replace('/(onboarding)/welcome');
                });
              },
            });
          }}
        />
      }
    >
      <Notice title={t('account.delete.warning')} tone="warning" />

      {blocked ? (
        <View className="w-full gap-3">
          <ErrorState message={t('account.delete.blockedDescription')} />
          <Card title={t('account.delete.blockedTitle')}>
            <Text className="text-base leading-relaxed text-ink-muted">
              {t('account.delete.blockedDescription')}
            </Text>
            <Button
              label={t('account.delete.blockedAction')}
              onPress={() => {
                router.push('/billing/manage-subscription');
              }}
            />
          </Card>
        </View>
      ) : null}

      {deleteAccount.isError && !blocked ? (
        <ErrorState message={errorMessage(deleteAccount.error, t)} />
      ) : null}

      <TextField
        label={t('account.delete.confirmationLabel')}
        value={confirmation}
        onChangeText={setConfirmation}
        autoCapitalize="none"
      />
    </Screen>
  );
}
