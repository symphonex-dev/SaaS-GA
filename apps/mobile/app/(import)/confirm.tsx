import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Row, Screen } from '../../components/layout';
import { Button } from '../../components/controls';
import { EmptyState, ErrorState, Notice } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import { useImportRollback } from '../../lib/hooks';
import { useImportFlow } from '../../store/import';

/**
 * Fin d'import (`specs/ui-composants-mobile.md` §4 et §14).
 *
 * État `completed`, avec `rollback_available` tant que le lot n'a pas été
 * annulé. Le rollback ne supprime que les dépenses créées par ce lot
 * (`specs/import-releves.md` §10).
 */
export default function ConfirmImport(): ReactNode {
  const { t } = useTranslation();
  const router = useRouter();
  const importFlow = useImportFlow();
  const rollback = useImportRollback();

  const result = importFlow.result;

  if (result === null) {
    return (
      <Screen title={t('import.confirm.title')}>
        <EmptyState
          title={t('common.empty')}
          actionLabel={t('dashboard.title')}
          onAction={() => {
            router.replace('/(tabs)/dashboard');
          }}
        />
      </Screen>
    );
  }

  const rolledBack = result.batch.rolledBackAt !== null || rollback.isSuccess;

  return (
    <Screen
      title={t('import.confirm.title')}
      footer={
        <View className="w-full gap-3">
          <Button
            label={t('import.confirm.goToDashboard')}
            onPress={() => {
              importFlow.reset();
              router.replace('/(tabs)/dashboard');
            }}
          />
          {rolledBack ? null : (
            <Button
              label={t('import.confirm.rollback')}
              variant="secondary"
              loading={rollback.isPending}
              onPress={() => {
                rollback.mutate(result.batch.id, {
                  onSuccess: () => {
                    // Le lot vient d'être annulé : il n'est plus annulable.
                    importFlow.setState('completed');
                  },
                });
              }}
            />
          )}
        </View>
      }
    >
      {rollback.isError ? <ErrorState message={errorMessage(rollback.error, t)} /> : null}

      {rolledBack ? (
        <Notice title={t('import.confirm.rollbackDone')} tone="positive" />
      ) : (
        <Notice title={t('import.states.rollbackAvailable')} />
      )}

      <Card>
        <Row
          label={t('import.confirm.imported', { count: result.batch.importedCount })}
          value={String(result.batch.importedCount)}
        />
        <Row
          label={t('import.confirm.rejected', { count: result.batch.rejectedCount })}
          value={String(result.batch.rejectedCount)}
        />
        <Row
          label={t('import.confirm.duplicates', { count: result.batch.duplicateCount })}
          value={String(result.batch.duplicateCount)}
        />
      </Card>
    </Screen>
  );
}
