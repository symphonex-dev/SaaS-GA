import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Screen } from '../../components/layout';
import { Button } from '../../components/controls';
import { ErrorState, Notice } from '../../components/states';
import { errorCode, errorMessage } from '../../lib/errors';
import { useImportPreview } from '../../lib/hooks';
import { CSV_MIME_TYPES, PDF_MIME_TYPE, resolveMimeType } from '../../lib/import-upload';
import { IMPORT_STATE_LABEL_KEYS, useImportFlow } from '../../store/import';

/**
 * Sélection et envoi du fichier (`specs/ui-composants-mobile.md` §4 et §14).
 *
 * Le fichier part tel quel vers `POST /api/imports/preview` : aucune lecture,
 * aucun parsing, aucun comptage n'est fait sur l'appareil (CLAUDE.md §5.1). Le
 * serveur analyse puis supprime immédiatement le fichier source.
 *
 * Cas couverts par l'écran : sélection annulée, sélecteur en échec, fichier
 * sans type MIME, échec réseau, fichier trop volumineux ou trop long, colonnes
 * non reconnues, PDF réservé à l'offre Plus. Aucun de ces cas n'est décidé
 * ici : le serveur tranche, l'écran traduit le code renvoyé.
 *
 * États couverts : `idle → uploading → preview | validation_error`.
 */
export default function Upload(): ReactNode {
  const { t } = useTranslation();
  const router = useRouter();
  const importFlow = useImportFlow();
  const preview = useImportPreview();
  const [pickerFailed, setPickerFailed] = useState(false);

  const isPdf = importFlow.source === 'PDF';

  async function pickFile(): Promise<void> {
    setPickerFailed(false);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: isPdf ? PDF_MIME_TYPE : [...CSV_MIME_TYPES],
        // Indispensable : l'URI d'un fournisseur de documents Android n'est pas
        // lisible directement par la couche réseau. La copie en cache l'est.
        copyToCacheDirectory: true,
        multiple: false,
      });

      const asset = result.assets?.[0];

      // Sélection annulée, ou fournisseur qui ne renvoie aucun fichier
      // exploitable : on ne change rien à l'état courant.
      if (result.canceled || asset === undefined || asset.uri.length === 0) {
        return;
      }

      importFlow.setFile({
        uri: asset.uri,
        name: asset.name.length > 0 ? asset.name : t('import.upload.defaultFileName'),
        // Certains fournisseurs Android ne renseignent aucun type MIME : le
        // serveur revalide le contenu réel de toute façon.
        mimeType: resolveMimeType(asset.mimeType, isPdf ? 'PDF' : 'CSV'),
      });
    } catch {
      // Sélecteur indisponible ou permission refusée : état explicite, jamais
      // un plantage ni un silence.
      setPickerFailed(true);
    }
  }

  function analyse(): void {
    const file = importFlow.file;

    if (file === null) {
      return;
    }

    importFlow.setState('uploading');

    preview.mutate(file, {
      onSuccess: (data) => {
        importFlow.setPreview(data);
        router.push('/(import)/review-lines');
      },
      onError: (error) => {
        // Colonnes non reconnues : l'utilisateur les désigne lui-même.
        if (errorCode(error) === 'IMPORT_MAPPING_REQUIRED') {
          importFlow.setState('validation_error');
          router.push('/(import)/column-mapping');

          return;
        }

        importFlow.setState('idle');
      },
    });
  }

  return (
    <Screen
      title={t('import.upload.title')}
      showBack
      footer={
        <Button
          label={t('import.upload.submit')}
          disabled={importFlow.file === null}
          loading={preview.isPending}
          onPress={analyse}
        />
      }
    >
      {isPdf ? <Notice title={t('import.review.pdfNotice')} tone="warning" /> : null}

      {pickerFailed ? <ErrorState message={t('import.upload.pickerFailed')} /> : null}
      {preview.isError ? <ErrorState message={errorMessage(preview.error, t)} /> : null}

      <View className="w-full gap-3">
        <Button
          label={t('import.upload.pick')}
          variant="secondary"
          onPress={() => {
            void pickFile();
          }}
        />

        {importFlow.file === null ? null : (
          <Text className="text-base text-ink">
            {t('import.upload.selected', { name: importFlow.file.name })}
          </Text>
        )}

        <Text className="text-sm text-ink-subtle">{t('import.upload.hint', { size: 10 })}</Text>
      </View>

      <Notice
        title={t(IMPORT_STATE_LABEL_KEYS[preview.isPending ? 'uploading' : importFlow.state])}
      />
    </Screen>
  );
}
