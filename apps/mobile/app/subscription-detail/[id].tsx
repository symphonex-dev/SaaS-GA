import { EXPENSE_FREQUENCIES, type ExpenseFrequency } from '@subscription-manager/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Row, Screen, SectionTitle } from '../../components/layout';
import { Button, OptionList } from '../../components/controls';
import { EmptyState, ErrorState, LoadingState, Notice, Pill } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import { useDetectionAction, useModifyDetection, useSubscriptions } from '../../lib/hooks';
import { intlLocale } from '../../lib/i18n';
import { formatDate, formatMoney } from '../../lib/money';

/**
 * Détail d'un abonnement (`specs/ui-composants-mobile.md` §6,
 * `specs/moteur-recurrence.md` §8).
 *
 * L'utilisateur peut toujours confirmer, corriger la fréquence, ou rejeter la
 * détection : aucune récurrence n'est appliquée sans possibilité de refus.
 */
const MODIFIABLE_FREQUENCIES = EXPENSE_FREQUENCIES.filter(
  (frequency): frequency is Exclude<ExpenseFrequency, 'ONCE'> => frequency !== 'ONCE',
);

export default function SubscriptionDetail(): ReactNode {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = intlLocale(i18n.language);
  const params = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, error, refetch } = useSubscriptions();
  const action = useDetectionAction();
  const modify = useModifyDetection();
  const [showFrequencies, setShowFrequencies] = useState(false);

  if (isLoading) {
    return (
      <Screen title={t('subscriptions.title')} showBack>
        <LoadingState />
      </Screen>
    );
  }

  if (isError || data === undefined) {
    return (
      <Screen title={t('subscriptions.title')} showBack>
        <ErrorState
          message={errorMessage(error, t)}
          onRetry={() => {
            void refetch();
          }}
        />
      </Screen>
    );
  }

  const subscription = data.find((entry) => entry.detectionId === params.id);

  if (subscription === undefined) {
    return (
      <Screen title={t('subscriptions.title')} showBack>
        <EmptyState title={t('errors.NOT_FOUND')} />
      </Screen>
    );
  }

  const isPending = action.isPending || modify.isPending;

  return (
    <Screen title={subscription.merchant} showBack>
      {action.isError ? <ErrorState message={errorMessage(action.error, t)} /> : null}
      {modify.isError ? <ErrorState message={errorMessage(modify.error, t)} /> : null}

      <Card>
        <View className="w-full flex-row flex-wrap gap-2">
          <Pill label={t(`subscriptions.status.${subscription.status}`)} />
          <Pill
            label={`${t('subscriptions.fields.confidence')} : ${t(`subscriptions.confidence.${subscription.confidence}`)}`}
          />
        </View>

        <Row
          label={t('subscriptions.fields.amount')}
          value={formatMoney(subscription.amount, locale)}
        />
        <Row
          label={t('subscriptions.fields.category')}
          value={t(`category.${subscription.category}`)}
        />
        <Row
          label={t('subscriptions.fields.frequency')}
          value={t(`frequency.${subscription.frequency}`)}
        />
        <Row
          label={t('subscriptions.fields.annualCost')}
          value={
            subscription.annualCost === null ? '—' : formatMoney(subscription.annualCost, locale)
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

        <Text className="text-xs text-ink-subtle">{t('subscriptions.nextPaymentNotice')}</Text>
      </Card>

      {subscription.priceChange === null ? null : (
        <Notice
          title={t('dashboard.sections.priceAlerts')}
          description={t('dashboard.priceAlert', {
            merchant: subscription.merchant,
            previous: formatMoney(subscription.priceChange.previousAmount, locale),
            current: formatMoney(subscription.priceChange.currentAmount, locale),
            percentage: `+${subscription.priceChange.percentage} %`,
          })}
          tone="warning"
        />
      )}

      <SectionTitle>{t('subscriptions.fields.status')}</SectionTitle>

      <View className="w-full gap-3">
        <Button
          label={t('subscriptions.actions.confirm')}
          loading={isPending}
          onPress={() => {
            action.mutate({ id: subscription.detectionId, action: 'confirm' });
          }}
        />

        <Button
          label={t('subscriptions.actions.modify')}
          variant="secondary"
          onPress={() => {
            setShowFrequencies(!showFrequencies);
          }}
        />

        {showFrequencies ? (
          <OptionList
            label={t('subscriptions.fields.frequency')}
            options={MODIFIABLE_FREQUENCIES.map((frequency) => ({
              value: frequency,
              label: t(`frequency.${frequency}`),
            }))}
            selected={subscription.frequency === 'ONCE' ? null : subscription.frequency}
            onSelect={(frequency) => {
              modify.mutate({ id: subscription.detectionId, frequency });
              setShowFrequencies(false);
            }}
          />
        ) : null}

        <Button
          label={t('subscriptions.actions.compare')}
          variant="secondary"
          onPress={() => {
            router.push(`/comparison/${subscription.expenseId}`);
          }}
        />

        {/* L'utilisateur peut toujours rejeter une proposition (§8 du moteur). */}
        <Button
          label={t('subscriptions.actions.reject')}
          variant="ghost"
          loading={isPending}
          onPress={() => {
            action.mutate(
              { id: subscription.detectionId, action: 'reject' },
              {
                onSuccess: () => {
                  router.back();
                },
              },
            );
          }}
        />
      </View>
    </Screen>
  );
}
