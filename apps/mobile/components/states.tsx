import type { ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from './controls';

/**
 * États d'écran (`specs/ui-composants-mobile.md` §14).
 *
 * Chaque écran gère explicitement : chargement, vide, erreur de validation,
 * erreur serveur, absence de droit, limite de débit. Ces composants donnent la
 * même forme à tous ces états, avec un texte lisible par un lecteur d'écran.
 */
export function LoadingState({ label }: { label?: string }): ReactNode {
  const { t } = useTranslation();

  return (
    <View
      accessible
      accessibilityLabel={label ?? t('a11y.loading')}
      accessibilityRole="progressbar"
      className="w-full items-center justify-center gap-3 py-12"
    >
      <ActivityIndicator size="large" color="#1d4ed8" />
      <Text className="text-base text-ink-muted">{label ?? t('common.loading')}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}): ReactNode {
  return (
    <View className="w-full items-center gap-3 rounded-2xl border border-dashed border-surface-border bg-surface px-5 py-10">
      <Text accessibilityRole="header" className="text-center text-lg font-semibold text-ink">
        {title}
      </Text>
      {description === undefined ? null : (
        <Text className="text-center text-base text-ink-muted">{description}</Text>
      )}
      {actionLabel === undefined || onAction === undefined ? null : (
        <View className="w-full pt-2">
          <Button label={actionLabel} onPress={onAction} />
        </View>
      )}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): ReactNode {
  const { t } = useTranslation();

  return (
    <View className="w-full gap-3 rounded-2xl border border-negative/30 bg-negative/5 px-4 py-4">
      <Text accessibilityRole="alert" className="text-base font-medium text-negative">
        {message}
      </Text>
      {onRetry === undefined ? null : (
        <Button label={t('common.retry')} variant="secondary" onPress={onRetry} />
      )}
    </View>
  );
}

type NoticeTone = 'info' | 'warning' | 'positive';

const NOTICE_CLASSES: Record<NoticeTone, string> = {
  info: 'border-brand-100 bg-brand-50',
  warning: 'border-warning/30 bg-warning/10',
  positive: 'border-positive/30 bg-positive/10',
};

const NOTICE_TEXT_CLASSES: Record<NoticeTone, string> = {
  info: 'text-brand-700',
  warning: 'text-warning',
  positive: 'text-positive',
};

/** Encart d'information : le ton est aussi porté par le texte, pas que par la couleur. */
export function Notice({
  title,
  description,
  tone = 'info',
}: {
  title: string;
  description?: string;
  tone?: NoticeTone;
}): ReactNode {
  return (
    <View
      accessible
      accessibilityLabel={description === undefined ? title : `${title}. ${description}`}
      className={`w-full gap-1 rounded-xl border px-4 py-3 ${NOTICE_CLASSES[tone]}`}
    >
      <Text className={`text-sm font-semibold ${NOTICE_TEXT_CLASSES[tone]}`}>{title}</Text>
      {description === undefined ? null : (
        <Text className="text-sm leading-snug text-ink-muted">{description}</Text>
      )}
    </View>
  );
}

type PillTone = 'neutral' | 'positive' | 'negative' | 'warning';

const PILL_CLASSES: Record<PillTone, string> = {
  neutral: 'bg-surface-muted',
  positive: 'bg-positive/10',
  negative: 'bg-negative/10',
  warning: 'bg-warning/10',
};

const PILL_TEXT_CLASSES: Record<PillTone, string> = {
  neutral: 'text-ink-muted',
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
};

/**
 * Étiquette de statut. Le libellé est toujours écrit en toutes lettres :
 * l'information n'est jamais portée par la seule couleur (§14).
 */
export function Pill({ label, tone = 'neutral' }: { label: string; tone?: PillTone }): ReactNode {
  return (
    <View className={`self-start rounded-full px-3 py-1 ${PILL_CLASSES[tone]}`}>
      <Text className={`text-xs font-semibold ${PILL_TEXT_CLASSES[tone]}`}>{label}</Text>
    </View>
  );
}
