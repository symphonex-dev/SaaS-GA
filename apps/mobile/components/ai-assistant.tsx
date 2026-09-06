import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from './controls';
import { Card } from './layout';
import { ErrorState, LoadingState, Notice, Pill } from './states';
import { errorCode, errorMessage } from '../lib/errors';
import { useAiAnswer, useAiQuota, type AiTaskKey } from '../lib/hooks';

/**
 * Assistant IA borné (`specs/ui-composants-mobile.md` §9,
 * `specs/comparateur-et-assistant-ia.md` partie B).
 *
 * **Trois usages, pas un de plus** (CLAUDE.md §5.6) : résumé du mois,
 * explication d'une hausse, une recommandation. Il n'existe :
 *  - aucune zone de saisie de question libre ;
 *  - aucun historique de conversation ;
 *  - aucun appel direct à un fournisseur d'IA depuis le mobile — la clé
 *    `AI_API_KEY` reste exclusivement côté serveur (CLAUDE.md §6) ;
 *  - aucun contexte envoyé par le client : le serveur constitue lui-même les
 *    faits à partir de chiffres déjà calculés (B.5).
 *
 * Le quota est décompté **par le serveur** avant l'appel au provider (B.8) :
 * le compteur affiché ici est informatif et n'autorise rien.
 *
 * Une réponse `degraded` est le repli statique traduit du serveur, affiché
 * comme tel : l'IA est un enrichissement, jamais un prérequis fonctionnel.
 */
const TASKS: readonly AiTaskKey[] = ['MONTHLY_SUMMARY', 'EXPLAIN_INCREASE', 'RECOMMENDATION'];

export function AiAssistant(): ReactNode {
  const { t } = useTranslation();
  const quota = useAiQuota();
  const answer = useAiAnswer();

  const remaining = answer.data?.quota.creditsRemaining ?? quota.data?.creditsRemaining ?? null;
  const unavailable = errorCode(answer.error) === 'AI_UNAVAILABLE';
  const quotaExceeded = errorCode(answer.error) === 'AI_QUOTA_EXCEEDED';

  return (
    <Card title={t('ai.title')}>
      <Text className="text-sm leading-snug text-ink-muted">{t('ai.subtitle')}</Text>

      {remaining === null ? null : (
        <Pill
          label={t('ai.quota', { count: remaining })}
          tone={remaining > 0 ? 'neutral' : 'warning'}
        />
      )}

      <View className="w-full gap-2 pt-1">
        {TASKS.map((task) => (
          <Button
            key={task}
            label={t(`ai.tasks.${task}`)}
            variant="secondary"
            loading={answer.isPending && answer.variables === task}
            disabled={answer.isPending}
            onPress={() => {
              answer.mutate(task);
            }}
          />
        ))}
      </View>

      {answer.isPending ? <LoadingState label={t('ai.pending')} /> : null}

      {unavailable ? <Notice title={t('errors.AI_UNAVAILABLE')} /> : null}
      {quotaExceeded ? <Notice title={t('errors.AI_QUOTA_EXCEEDED')} tone="warning" /> : null}
      {answer.isError && !unavailable && !quotaExceeded ? (
        <ErrorState message={errorMessage(answer.error, t)} />
      ) : null}

      {answer.data === undefined ? null : (
        <View className="w-full gap-2 pt-2">
          <View className="flex-row flex-wrap gap-2">
            <Pill label={t(`ai.tasks.${answer.data.task}`)} />
            <Pill
              label={`${t('ai.uncertainty.label')} : ${t(`ai.uncertainty.${answer.data.uncertainty}`)}`}
              tone={answer.data.uncertainty === 'HIGH' ? 'warning' : 'neutral'}
            />
            {answer.data.degraded ? <Pill label={t('ai.degraded')} tone="warning" /> : null}
          </View>

          <Text className="text-base leading-relaxed text-ink">{answer.data.answer}</Text>

          {/* Rappel permanent : l'IA met en phrase des chiffres, elle ne conseille pas. */}
          <Text className="text-xs leading-snug text-ink-subtle">{t('ai.disclaimer')}</Text>
        </View>
      )}
    </Card>
  );
}
