import type { RecurringSummaryDto } from '@subscription-manager/shared';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Row, Screen } from '../../components/layout';
import { EmptyState, ErrorState, LoadingState, Pill } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import { useSubscriptions } from '../../lib/hooks';
import { intlLocale } from '../../lib/i18n';
import { formatDate, formatMoney } from '../../lib/money';

/**
 * Page Abonnements (`specs/ui-composants-mobile.md` §6).
 *
 * Chaque récurrence affiche : service, catégorie, montant, devise, fréquence,
 * coût annuel, dernier paiement, prochaine échéance **présentée comme une
 * prévision**, variation de montant, niveau de confiance et statut.
 *
 * Toutes ces valeurs viennent du serveur : rien n'est recalculé ici.
 */
function statusTone(status: RecurringSummaryDto['status']): 'neutral' | 'positive' | 'warning' {
  switch (status) {
    case 'CONFIRMED':
      return 'positive';
    case 'REJECTED':
      return 'neutral';
    default:
      return 'warning';
  }
}

export default function Subscriptions(): ReactNode {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = intlLocale(i18n.language);
  const { data, isLoading, isError, error, refetch } = useSubscriptions();

  if (isLoading) {
    return (
      <Screen title={t('subscriptions.title')}>
        <LoadingState />
      </Screen>
    );
  }

  if (isError || data === undefined) {
    return (
      <Screen title={t('subscriptions.title')}>
        <ErrorState
          message={errorMessage(error, t)}
          onRetry={() => {
            void refetch();
          }}
        />
      </Screen>
    );
  }

  if (data.length === 0) {
    return (
      <Screen title={t('subscriptions.title')}>
        <EmptyState
          title={t('subscriptions.empty')}
          description={t('dashboard.empty.description')}
          actionLabel={t('dashboard.empty.action')}
          onAction={() => {
            router.push('/(import)/choose-source');
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen title={t('subscriptions.title')}>
      {data.map((subscription) => (
        <Pressable
          key={subscription.detectionId}
          accessibilityRole="button"
          accessibilityLabel={`${subscription.merchant}, ${formatMoney(subscription.amount, locale)}`}
          onPress={() => {
            router.push(`/subscription-detail/${subscription.detectionId}`);
          }}
          className="w-full active:opacity-80"
        >
          <Card>
            <View className="w-full flex-row items-start justify-between gap-3">
              <View className="shrink gap-1">
                <Text className="text-lg font-semibold text-ink">{subscription.merchant}</Text>
                <Text className="text-sm text-ink-muted">
                  {t(`category.${subscription.category}`)}
                </Text>
              </View>
              <Text className="text-lg font-bold text-ink">
                {formatMoney(subscription.amount, locale)}
              </Text>
            </View>

            <View className="w-full flex-row flex-wrap gap-2">
              <Pill
                label={`${t('subscriptions.fields.status')} : ${t(`subscriptions.status.${subscription.status}`)}`}
                tone={statusTone(subscription.status)}
              />
              <Pill
                label={`${t('subscriptions.fields.confidence')} : ${t(`subscriptions.confidence.${subscription.confidence}`)}`}
              />
            </View>

            <Row
              label={t('subscriptions.fields.frequency')}
              value={t(`frequency.${subscription.frequency}`)}
            />
            <Row
              label={t('subscriptions.fields.annualCost')}
              value={
                subscription.annualCost === null
                  ? '—'
                  : formatMoney(subscription.annualCost, locale)
              }
            />
            <Row
              label={t('subscriptions.fields.lastPayment')}
              value={formatDate(subscription.lastPaymentDate, locale)}
            />
            <Row
              label={t('subscriptions.fields.nextPayment')}
              value={
                subscription.nextExpectedDate === null
                  ? '—'
                  : formatDate(subscription.nextExpectedDate, locale)
              }
            />

            {subscription.priceChange === null ? null : (
              <Text className="text-sm font-medium text-negative">
                {t('dashboard.priceAlert', {
                  merchant: subscription.merchant,
                  previous: formatMoney(subscription.priceChange.previousAmount, locale),
                  current: formatMoney(subscription.priceChange.currentAmount, locale),
                  percentage: `+${subscription.priceChange.percentage} %`,
                })}
              </Text>
            )}

            {/* La prochaine échéance est une prévision, jamais une certitude (§6). */}
            <Text className="text-xs text-ink-subtle">{t('subscriptions.nextPaymentNotice')}</Text>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
