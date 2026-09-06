import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Screen } from '../../components/layout';
import { Button, TextField } from '../../components/controls';
import { ErrorState, Notice } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import { useImportPreview } from '../../lib/hooks';
import { useImportFlow } from '../../store/import';

/**
 * Correspondance des colonnes — CSV uniquement
 * (`specs/import-releves.md` §4.4, `specs/ui-composants-mobile.md` §2).
 *
 * Affiché quand le serveur a refusé de deviner les colonnes
 * (`IMPORT_MAPPING_REQUIRED`). Le mapping choisi est renvoyé au serveur, qui
 * réanalyse le fichier : rien n'est parsé sur l'appareil.
 */
function parseIndex(value: string): number | null {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  return Number(trimmed);
}

export default function ColumnMapping(): ReactNode {
  const { t } = useTranslation();
  const router = useRouter();
  const importFlow = useImportFlow();
  const preview = useImportPreview();

  const [dateColumn, setDateColumn] = useState('0');
  const [descriptionColumn, setDescriptionColumn] = useState('1');
  const [amountColumn, setAmountColumn] = useState('2');

  const indices = {
    dateColumn: parseIndex(dateColumn),
    descriptionColumn: parseIndex(descriptionColumn),
    amountColumn: parseIndex(amountColumn),
  };

  const isValid =
    indices.dateColumn !== null &&
    indices.descriptionColumn !== null &&
    indices.amountColumn !== null;

  function submit(): void {
    const file = importFlow.file;

    if (file === null || !isValid) {
      return;
    }

    // Le fichier est déjà choisi : ce que fait le serveur ici est une
    // **réanalyse** avec la correspondance de colonnes fournie (§14).
    importFlow.setState('parsing');

    preview.mutate(
      {
        ...file,
        mapping: {
          dateColumn: indices.dateColumn ?? 0,
          descriptionColumn: indices.descriptionColumn ?? 1,
          amountColumn: indices.amountColumn ?? 2,
        },
      },
      {
        onSuccess: (data) => {
          importFlow.setPreview(data);
          router.replace('/(import)/review-lines');
        },
        onError: () => {
          importFlow.setState('validation_error');
        },
      },
    );
  }

  return (
    <Screen
      title={t('import.mapping.title')}
      subtitle={t('import.mapping.subtitle')}
      showBack
      footer={
        <Button
          label={t('import.mapping.submit')}
          disabled={!isValid}
          loading={preview.isPending}
          onPress={submit}
        />
      }
    >
      {preview.isError ? <ErrorState message={errorMessage(preview.error, t)} /> : null}

      <Notice title={t('import.states.validationError')} tone="warning" />

      <TextField
        label={t('import.mapping.date')}
        value={dateColumn}
        onChangeText={setDateColumn}
        error={indices.dateColumn === null ? t('errors.VALIDATION_ERROR') : undefined}
      />
      <TextField
        label={t('import.mapping.description')}
        value={descriptionColumn}
        onChangeText={setDescriptionColumn}
        error={indices.descriptionColumn === null ? t('errors.VALIDATION_ERROR') : undefined}
      />
      <TextField
        label={t('import.mapping.amount')}
        value={amountColumn}
        onChangeText={setAmountColumn}
        error={indices.amountColumn === null ? t('errors.VALIDATION_ERROR') : undefined}
      />
    </Screen>
  );
}
