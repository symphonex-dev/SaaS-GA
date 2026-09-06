import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Screen } from '../../components/layout';
import { Button } from '../../components/controls';
import { AmountRow } from '../../components/dashboard-widgets';
import { EmptyState, ErrorState, LoadingState, Pill } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import { useExpenses } from '../../lib/hooks';
import { intlLocale } from '../../lib/i18n';
import { formatDate } from '../../lib/money';

/**
 * Transactions (`specs/ui-composants-mobile.md` §10).
 *
 * La saisie manuelle est une action **secondaire** : elle vit dans un lien
 * discret en bas de liste (« ajouter une transaction manquante »), jamais dans
 * un bouton principal ni dans l'onboarding (CLAUDE.md §5.4).
 */
export default function Transactions(): ReactNode {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = intlLocale(i18n.language);
  const { data, isLoading, isError, error, refetch } = useExpenses();

  if (isLoading) {
    return (
      <Screen title={t('transactions.title')}>
        <LoadingState />
      </Screen>
    );
  }

  if (isError || data === undefined) {
    return (
      <Screen title={t('transactions.title')}>
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
      <Screen title={t('transactions.title')}>
        <EmptyState
          title={t('transactions.empty')}
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
    <Screen title={t('transactions.title')}>
      <Card>
        {data.map((expense) => (
          <Pressable
            key={expense.id}
            accessibilityRole="button"
            accessibilityLabel={`${expense.merchantDisplay}. ${t('transactions.correct')}`}
            accessibilityHint={t('transactions.manual.editHint')}
            onPress={() => {
              router.push(`/expense/${expense.id}`);
            }}
            className="w-full border-b border-surface-border py-1 last:border-b-0 active:opacity-70"
          >
            <AmountRow
              label={expense.merchantDisplay}
              amount={expense.amount}
              locale={locale}
              caption={`${formatDate(expense.date.slice(0, 10), locale)} · ${t(`category.${expense.category}`)}`}
            />
            <View className="flex-row flex-wrap gap-2 pb-2">
              <Pill label={t(`transactions.source.${expense.source}`)} />
              {expense.status === 'TO_REVIEW' ? (
                <Pill label={t('dashboard.kpis.expensesToReview')} tone="warning" />
              ) : null}
              {expense.status === 'CANCELLED' ? (
                <Pill label={t('subscriptions.status.CANCELLED')} tone="neutral" />
              ) : null}
            </View>
          </Pressable>
        ))}
      </Card>

      <View className="w-full pt-2">
        {/* Action secondaire, volontairement discrète (§10). */}
        <Button
          label={t('transactions.addManual')}
          variant="ghost"
          accessibilityHint={t('transactions.manual.subtitle')}
          onPress={() => {
            router.push('/expense/new');
          }}
        />
        <Text className="px-2 text-center text-xs text-ink-subtle">
          {t('transactions.manual.secondaryNotice')}
        </Text>
      </View>
    </Screen>
  );
}
