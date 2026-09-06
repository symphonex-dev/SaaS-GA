import type { MoneyDto, MonthlyPointDto } from '@subscription-manager/shared';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatMoney, formatMonth } from '../lib/money';

/**
 * Widgets du tableau de bord (`specs/ui-composants-mobile.md` §5).
 *
 * ⚠️ Aucun de ces composants ne calcule un montant : ils reçoivent des valeurs
 * déjà arrêtées par `apps/api` (CLAUDE.md §5.1) et se contentent de les
 * formater et de les disposer.
 */
export function KpiCard({
  label,
  value,
  period,
  hint,
}: {
  label: string;
  value: string;
  /** Période explicite : jamais une valeur sans période (§5). */
  period: string;
  hint?: string;
}): ReactNode {
  const { t } = useTranslation();

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={t('a11y.kpiCard', { label, value, period })}
      className="min-w-[45%] flex-1 gap-1 rounded-2xl border border-surface-border bg-surface p-4"
    >
      <Text className="text-sm text-ink-muted">{label}</Text>
      <Text className="text-xl font-bold text-ink">{value}</Text>
      <Text className="text-xs text-ink-subtle">{hint ?? period}</Text>
    </View>
  );
}

/**
 * Graphique d'évolution : un seul graphique simple, pas de graphique avancé en
 * V1 (§5).
 *
 * Les hauteurs de barres sont calculées en `bigint` à partir des unités
 * mineures fournies par le serveur. C'est un calcul de **mise en page**, pas un
 * calcul financier : aucun montant affiché n'est dérivé ici.
 */
export function MonthlyChart({
  points,
  locale,
}: {
  points: readonly MonthlyPointDto[];
  locale: string;
}): ReactNode {
  const { t } = useTranslation();

  const values = points.map((point) => {
    try {
      const raw = BigInt(point.amount.minorUnits);

      return raw < 0n ? -raw : raw;
    } catch {
      return 0n;
    }
  });

  const maximum = values.reduce((highest, value) => (value > highest ? value : highest), 0n);

  return (
    <View
      accessible={false}
      accessibilityLabel={t('a11y.chartSummary', { count: points.length })}
      className="w-full gap-3"
    >
      <View className="w-full flex-row items-end justify-between gap-1.5" style={{ height: '55%' }}>
        {points.map((point, index) => {
          const value = values[index] ?? 0n;
          // Pourcentage entier de la barre la plus haute ; 2 % minimum pour
          // qu'un mois à zéro reste visible et annonçable.
          const heightPercent = maximum === 0n ? 2 : Math.max(2, Number((value * 100n) / maximum));

          return (
            <View
              key={point.month}
              accessible
              accessibilityRole="text"
              accessibilityLabel={t('a11y.chartBar', {
                month: formatMonth(point.month, locale),
                value: formatMoney(point.amount, locale),
              })}
              className="flex-1 items-center justify-end gap-1"
            >
              <View
                className="w-full rounded-t-md bg-brand-500"
                // `${number}%` est la forme attendue par `DimensionValue`.
                style={{ height: `${heightPercent}%` }}
              />
              <Text className="text-[10px] text-ink-subtle" numberOfLines={1}>
                {formatMonth(point.month, locale)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Variation période sur période.
 *
 * Le sens est écrit (« ↑ +12,4 % »), jamais signalé par la seule couleur (§14).
 * `null` correspond à une base de comparaison nulle : on ne montre jamais
 * « Infinity % » (`specs/calculs-financiers.md` §5).
 */
export function ChangeIndicator({
  direction,
  percentage,
}: {
  direction: 'UP' | 'DOWN' | 'UNCHANGED';
  percentage: string | null;
}): ReactNode {
  const { t } = useTranslation();

  if (percentage === null) {
    return (
      <Text className="text-sm text-ink-subtle">{t('dashboard.monthOverMonth.noComparison')}</Text>
    );
  }

  if (direction === 'UNCHANGED') {
    return (
      <Text className="text-sm text-ink-muted">{t('dashboard.monthOverMonth.unchanged')}</Text>
    );
  }

  const isUp = direction === 'UP';

  return (
    <Text className={`text-sm font-medium ${isUp ? 'text-negative' : 'text-positive'}`}>
      {isUp
        ? t('dashboard.monthOverMonth.up', { value: `${percentage} %` })
        : t('dashboard.monthOverMonth.down', { value: `${percentage} %` })}
    </Text>
  );
}

/** Ligne « montant + libellé » réutilisée par les listes financières. */
export function AmountRow({
  label,
  amount,
  locale,
  caption,
}: {
  label: string;
  amount: MoneyDto;
  locale: string;
  caption?: string;
}): ReactNode {
  const formatted = formatMoney(amount, locale);

  return (
    <View
      accessible
      accessibilityLabel={`${label} : ${formatted}`}
      className="w-full flex-row items-center justify-between gap-3 py-2"
    >
      <View className="shrink gap-0.5">
        <Text className="text-base text-ink">{label}</Text>
        {caption === undefined ? null : <Text className="text-xs text-ink-subtle">{caption}</Text>}
      </View>
      <Text className="text-base font-semibold text-ink">{formatted}</Text>
    </View>
  );
}
