import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AiAssistant } from '../../components/ai-assistant';
import { Card, Screen, SectionTitle } from '../../components/layout';
import { Button } from '../../components/controls';
import {
  AmountRow,
  ChangeIndicator,
  KpiCard,
  MonthlyChart,
} from '../../components/dashboard-widgets';
import { EmptyState, ErrorState, LoadingState, Notice, Pill } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import { useDashboard } from '../../lib/hooks';
import { intlLocale } from '../../lib/i18n';
import { formatDate, formatMoney, isZeroAmount } from '../../lib/money';

/**
 * Tableau de bord (`specs/ui-composants-mobile.md` §5).
 *
 * ⚠️ Aucun KPI n'est calculé ici. L'écran affiche `DashboardData`, produit
 * intégralement par `apps/api` (CLAUDE.md §5.1) : montants, pourcentages,
 * prochaines échéances et hausses de prix arrivent prêts à l'emploi.
 *
 * Chaque carte porte sa période : jamais une valeur sans période (§5).
 */
const EVOLUTION_MONTHS = 6;

export default function Dashboard(): ReactNode {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = intlLocale(i18n.language);
  const { data, isLoading, isError, error, refetch } = useDashboard();

  if (isLoading) {
    return (
      <Screen title={t('dashboard.title')}>
        <LoadingState />
      </Screen>
    );
  }

  if (isError || data === undefined) {
    return (
      <Screen title={t('dashboard.title')}>
        <ErrorState
          message={errorMessage(error, t)}
          onRetry={() => {
            void refetch();
          }}
        />
      </Screen>
    );
  }

  const periodLabel = `${formatDate(data.period.from, locale)} – ${formatDate(data.period.to, locale)}`;
  const hasData =
    data.kpis.activeSubscriptions > 0 ||
    data.monthlyEvolution.some((point) => !isZeroAmount(point.amount));

  if (!hasData) {
    return (
      <Screen title={t('dashboard.title')}>
        <EmptyState
          title={t('dashboard.empty.title')}
          description={t('dashboard.empty.description')}
          actionLabel={t('dashboard.empty.action')}
          onAction={() => {
            router.push('/(import)/choose-source');
          }}
        />
      </Screen>
    );
  }

  // Un seul graphique simple, sur 6 mois (§5) : les 6 derniers points des 12
  // renvoyés par le serveur, sans aucun recalcul.
  const evolution = data.monthlyEvolution.slice(-EVOLUTION_MONTHS);

  return (
    <Screen title={t('dashboard.title')}>
      <View className="w-full flex-row flex-wrap gap-3">
        <KpiCard
          label={t('dashboard.kpis.monthlyExpenses')}
          value={formatMoney(data.kpis.monthlyExpenses, locale)}
          period={periodLabel}
        />
        <KpiCard
          label={t('dashboard.kpis.activeSubscriptions')}
          value={String(data.kpis.activeSubscriptions)}
          period={periodLabel}
        />
        <KpiCard
          label={t('dashboard.kpis.annualRecurringCost')}
          value={formatMoney(data.kpis.annualRecurringCost, locale)}
          period={periodLabel}
        />
        <KpiCard
          label={t('dashboard.kpis.expensesToReview')}
          value={String(data.kpis.expensesToReview)}
          period={periodLabel}
        />
      </View>

      <Card title={t('dashboard.sections.evolution')}>
        <ChangeIndicator
          direction={data.monthOverMonth.direction}
          percentage={data.monthOverMonth.percentageChange}
        />
        <View className="h-48 w-full">
          <MonthlyChart points={evolution} locale={locale} />
        </View>
      </Card>

      {data.unconvertedCurrencies.length > 0 ? (
        <Notice
          title={t('dashboard.unconverted.title')}
          description={data.unconvertedCurrencies
            .map((entry) =>
              t('dashboard.unconverted.description', {
                count: entry.expenseCount,
                currency: entry.currency,
              }),
            )
            .join('\n')}
          tone="warning"
        />
      ) : null}

      <SectionTitle>{t('dashboard.sections.upcoming')}</SectionTitle>
      <Card>
        {data.upcomingExpenses.length === 0 ? (
          <Text className="text-base text-ink-muted">{t('common.empty')}</Text>
        ) : (
          data.upcomingExpenses.map((upcoming) => (
            <AmountRow
              key={`${upcoming.expenseId}-${upcoming.expectedDate}`}
              label={upcoming.merchant}
              amount={upcoming.amount}
              locale={locale}
              caption={`${t('common.estimate')} · ${formatDate(upcoming.expectedDate, locale)} · ${t(`frequency.${upcoming.frequency}`)}`}
            />
          ))
        )}
      </Card>

      <SectionTitle>{t('dashboard.sections.priceAlerts')}</SectionTitle>
      <Card>
        {data.priceAlerts.length === 0 ? (
          <Text className="text-base text-ink-muted">{t('dashboard.priceAlertsPlus')}</Text>
        ) : (
          data.priceAlerts.map((alert) => (
            <View key={alert.expenseId} className="w-full gap-1 py-2">
              <Text className="text-base font-medium text-ink">{alert.merchant}</Text>
              <Text className="text-sm text-ink-muted">
                {t('dashboard.priceAlert', {
                  merchant: alert.merchant,
                  previous: formatMoney(alert.previousAmount, locale),
                  current: formatMoney(alert.currentAmount, locale),
                  percentage: `+${alert.increasePercentage} %`,
                })}
              </Text>
            </View>
          ))
        )}
      </Card>

      <SectionTitle>{t('dashboard.sections.aiSummary')}</SectionTitle>
      {/* Trois usages bornés, aucune saisie libre (`specs/ui-composants-mobile.md` §9). */}
      <AiAssistant />

      <SectionTitle>{t('dashboard.sections.savings')}</SectionTitle>
      <Card>
        {/* Potentiel et confirmé restent visuellement distincts (§8). */}
        <View className="w-full gap-1 border-b border-surface-border pb-3">
          <Pill label={t('savings.potential')} tone="warning" />
          <Text className="text-xl font-bold text-ink">
            {formatMoney(data.savings.potential, locale)}
          </Text>
          <Text className="text-xs text-ink-subtle">{t('savings.potentialHint')}</Text>
        </View>
        <View className="w-full gap-1 pt-3">
          <Pill label={t('savings.confirmed')} tone="positive" />
          <Text className="text-xl font-bold text-ink">
            {formatMoney(data.savings.confirmed, locale)}
          </Text>
          <Text className="text-xs text-ink-subtle">{t('savings.confirmedHint')}</Text>
        </View>
      </Card>

      <View className="w-full pt-2">
        <Button
          label={t('dashboard.empty.action')}
          variant="secondary"
          onPress={() => {
            router.push('/(import)/choose-source');
          }}
        />
      </View>
    </Screen>
  );
}
