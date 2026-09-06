import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Screen } from '../../components/layout';
import { Button } from '../../components/controls';
import { ErrorState, Notice } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import { useExportData } from '../../lib/hooks';

/**
 * Export RGPD (`specs/auth-comptes-rgpd.md` §8).
 *
 * Le fichier est produit par le serveur et ne contient jamais de mot de passe,
 * de jeton de session ni d'identifiant de transaction de store. L'application
 * ne le retraite pas : elle le récupère et le remet à l'utilisateur.
 */
export default function ExportAccount(): ReactNode {
  const { t } = useTranslation();
  const exportData = useExportData();

  return (
    <Screen
      title={t('account.export.title')}
      showBack
      footer={
        <Button
          label={t('account.export.submit')}
          loading={exportData.isPending}
          onPress={() => {
            exportData.mutate();
          }}
        />
      }
    >
      <Card>
        <Text className="text-base leading-relaxed text-ink-muted">
          {t('account.export.description')}
        </Text>
      </Card>

      {exportData.isError ? <ErrorState message={errorMessage(exportData.error, t)} /> : null}

      {exportData.isSuccess ? (
        <Notice
          title={t('account.export.success')}
          description={`${String(exportData.data.length)} ${t('common.of')} JSON`}
          tone="positive"
        />
      ) : null}
    </Screen>
  );
}
