import type { ParsedRow } from '@subscription-manager/shared';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Row, Screen, SectionTitle } from '../../components/layout';
import { Button } from '../../components/controls';
import { EmptyState, ErrorState, Notice, Pill } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import { useImportConfirm } from '../../lib/hooks';
import { intlLocale } from '../../lib/i18n';
import { formatDate } from '../../lib/money';
import { acceptedRowNumbers, useImportFlow } from '../../store/import';

/**
 * Vérification avant import (`specs/ui-composants-mobile.md` §4).
 *
 * L'écran affiche ce que le serveur a trouvé : nombre de transactions, période
 * couverte, devise, débits/crédits, lignes illisibles, doublons possibles,
 * remboursements. Actions disponibles : inclure, exclure, confirmer, annuler.
 *
 * ⚠️ Aucun total, aucun doublon et aucun score de confiance n'est recalculé
 * ici : tout provient du DTO d'aperçu (`specs/import-releves.md` §4).
 */
const SECTION_ORDER = ['VALID', 'DUPLICATE', 'INVALID', 'REFUND', 'SKIPPED'] as const;

const SECTION_KEYS: Record<(typeof SECTION_ORDER)[number], string> = {
  VALID: 'import.review.sections.valid',
  DUPLICATE: 'import.review.sections.duplicate',
  INVALID: 'import.review.sections.invalid',
  REFUND: 'import.review.sections.refund',
  SKIPPED: 'import.review.sections.skipped',
};

export default function ReviewLines(): ReactNode {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = intlLocale(i18n.language);
  const importFlow = useImportFlow();
  const confirmImport = useImportConfirm();

  const preview = importFlow.preview;

  if (preview === null) {
    return (
      <Screen title={t('import.review.title')} showBack>
        <EmptyState
          title={t('errors.IMPORT_PREVIEW_EXPIRED')}
          actionLabel={t('import.title')}
          onAction={() => {
            router.replace('/(import)/choose-source');
          }}
        />
      </Screen>
    );
  }

  const accepted = acceptedRowNumbers(preview, importFlow.excludedRows);

  const rowsByStatus = SECTION_ORDER.map((status) => ({
    status,
    rows: preview.rows.filter((row) => row.status === status),
  })).filter((section) => section.rows.length > 0);

  const duplicateConfidence = new Map(
    preview.duplicates.map((candidate) => [candidate.importedRowNumber, candidate.confidence]),
  );

  function renderRow(row: ParsedRow): ReactNode {
    const excluded = importFlow.excludedRows.has(row.rowNumber);
    const confidence = duplicateConfidence.get(row.rowNumber);
    const canToggle = row.status === 'VALID' || confidence === 'MEDIUM';

    return (
      <View key={row.rowNumber} className="w-full gap-1 border-b border-surface-border py-3">
        <View className="w-full flex-row items-start justify-between gap-3">
          <View className="shrink gap-0.5">
            <Text className="text-base font-medium text-ink">
              {row.parsed?.merchantNormalized ??
                t('import.review.rowNumber', { number: row.rowNumber })}
            </Text>
            <Text className="text-xs text-ink-subtle">
              {t('import.review.rowNumber', { number: row.rowNumber })}
            </Text>
          </View>

          {row.parsed === undefined ? null : (
            <View className="items-end">
              <Text className="text-base font-semibold text-ink">
                {`${row.parsed.amount} ${row.parsed.currency}`}
              </Text>
              <Text className="text-xs text-ink-subtle">{formatDate(row.parsed.date, locale)}</Text>
            </View>
          )}
        </View>

        <View className="w-full flex-row flex-wrap gap-2">
          {row.parsed === undefined ? null : (
            <Pill
              label={
                row.parsed.direction === 'DEBIT'
                  ? t('import.review.debits')
                  : t('import.review.credits')
              }
            />
          )}
          {confidence === undefined ? null : (
            <Pill
              label={
                confidence === 'HIGH'
                  ? t('import.review.duplicateHigh')
                  : t('import.review.duplicateMedium')
              }
              tone="warning"
            />
          )}
          {/* Chaque erreur est affichée en toutes lettres, jamais un code brut. */}
          {row.errors.map((rowError) => (
            <Pill key={rowError.code} label={t(`rows.${rowError.code}`)} tone="negative" />
          ))}
        </View>

        {canToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={excluded ? t('import.review.include') : t('import.review.exclude')}
            accessibilityState={{ selected: !excluded }}
            onPress={() => {
              importFlow.toggleRow(row.rowNumber);
            }}
            className="self-start rounded-lg bg-surface-muted px-3 py-2 active:opacity-70"
          >
            <Text className="text-sm font-medium text-brand-600">
              {excluded ? t('import.review.include') : t('import.review.exclude')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <Screen
      title={t('import.review.title')}
      showBack
      footer={
        <View className="w-full gap-3">
          <Button
            label={t('import.review.submit', { count: accepted.length })}
            disabled={accepted.length === 0}
            loading={confirmImport.isPending}
            onPress={() => {
              importFlow.setState('importing');

              confirmImport.mutate(
                {
                  importId: preview.importId,
                  acceptedRows: accepted,
                  rejectedRows: [...importFlow.excludedRows],
                },
                {
                  onSuccess: (result) => {
                    importFlow.setResult(result);
                    // Le lot est enregistré, et reste annulable tant qu'il n'a
                    // pas été annulé (`specs/import-releves.md` §10).
                    importFlow.setState(
                      result.batch.rolledBackAt === null ? 'rollback_available' : 'completed',
                    );
                    router.replace('/(import)/confirm');
                  },
                  onError: () => {
                    importFlow.setState('validation_error');
                  },
                },
              );
            }}
          />
          <Button
            label={t('import.review.cancelImport')}
            variant="ghost"
            onPress={() => {
              importFlow.reset();
              router.replace('/(tabs)/dashboard');
            }}
          />
        </View>
      }
    >
      {confirmImport.isError ? <ErrorState message={errorMessage(confirmImport.error, t)} /> : null}

      {preview.warningKeys.includes('import.pdf.limitedCompatibility') ? (
        <Notice title={t('import.review.pdfNotice')} tone="warning" />
      ) : null}

      <Card>
        <Row
          label={t('import.review.detected', { count: preview.counts.total })}
          value={String(preview.counts.total)}
        />
        <Row label={t('import.review.currency')} value={preview.defaultCurrency} />
        <Row
          label={t('import.review.dateOrder', {
            order:
              preview.dateOrder === 'DMY'
                ? t('import.review.dateOrderDMY')
                : t('import.review.dateOrderMDY'),
          })}
          value={preview.dateOrder}
        />
        <Row label={t('import.review.sections.valid')} value={String(preview.counts.valid)} />
        <Row
          label={t('import.review.sections.duplicate')}
          value={String(preview.counts.duplicate)}
        />
        <Row label={t('import.review.sections.invalid')} value={String(preview.counts.invalid)} />
        <Row label={t('import.review.sections.refund')} value={String(preview.counts.refund)} />
        <Row label={t('import.review.sections.skipped')} value={String(preview.counts.skipped)} />
      </Card>

      {rowsByStatus.map((section) => (
        <View key={section.status} className="w-full gap-2">
          <SectionTitle>{t(SECTION_KEYS[section.status])}</SectionTitle>
          <Card>{section.rows.map(renderRow)}</Card>
        </View>
      ))}
    </Screen>
  );
}
