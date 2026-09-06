import type { UserSavingsGoalDto } from '@subscription-manager/shared';
import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, TextField } from '../../components/controls';
import { Card, Divider, Row, Screen, SectionTitle } from '../../components/layout';
import { EmptyState, ErrorState, LoadingState, Notice, Pill } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import {
  useCreateSavingsGoal,
  useDashboard,
  useDeleteSavingsGoal,
  useSavingsGoals,
  useUpdateSavingsGoal,
} from '../../lib/hooks';
import { intlLocale } from '../../lib/i18n';
import { formatMoney } from '../../lib/money';
import { minorUnitsToInputValue, parseAmountToMinorUnits } from '../../lib/money-input';

/**
 * Économies (`specs/ui-composants-mobile.md` §8).
 *
 * Potentielles et confirmées ne sont **jamais mélangées visuellement** : deux
 * cartes distinctes, deux libellés explicites. Une économie ne devient
 * confirmée que si l'utilisateur la valide — l'application ne la promeut jamais
 * d'elle-même (`specs/calculs-financiers.md` §6). C'est exactement ce que fait
 * le champ « montant atteint » : il n'est écrit que sur action explicite, et le
 * serveur en tire le statut de l'objectif.
 *
 * Les deux montants affichés en tête viennent de `GET /api/dashboard` : ils
 * sont calculés par le serveur, jamais ici (CLAUDE.md §5.1).
 *
 * Aucun virement, aucune cagnotte, aucun investissement : hors V1.
 */
function GoalCard({
  goal,
  locale,
  onConfirm,
  onDelete,
  confirming,
  deleting,
}: {
  goal: UserSavingsGoalDto;
  locale: string;
  onConfirm: (achievedMinorUnits: string) => void;
  onDelete: () => void;
  confirming: boolean;
  deleting: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const currency = goal.targetAmount.currency;
  const [achieved, setAchieved] = useState(() =>
    minorUnitsToInputValue(goal.achievedAmount.minorUnits, currency),
  );
  const [invalid, setInvalid] = useState(false);

  return (
    <Card>
      {/* Le statut est écrit en toutes lettres : jamais porté par la couleur seule. */}
      <Pill
        label={`${t('savings.goal.status')} : ${t(`savings.goal.statuses.${goal.status}`)}`}
        tone={goal.status === 'REACHED' ? 'positive' : 'neutral'}
      />

      <Row label={t('savings.goal.target')} value={formatMoney(goal.targetAmount, locale)} />
      <Row label={t('savings.goal.achieved')} value={formatMoney(goal.achievedAmount, locale)} />

      <Divider />

      <TextField
        label={t('savings.goal.confirmLabel', { currency })}
        hint={t('savings.goal.confirmHint')}
        value={achieved}
        onChangeText={(next) => {
          setAchieved(next);
          setInvalid(false);
        }}
        error={invalid ? t('transactions.manual.amountError') : undefined}
      />

      <Button
        label={t('savings.goal.confirmSubmit')}
        loading={confirming}
        onPress={() => {
          // « 0 » est une valeur légitime ici : elle annule une confirmation.
          const trimmed = achieved.trim();
          const parsed =
            trimmed === '0' || trimmed === ''
              ? { minorUnits: '0' }
              : parseAmountToMinorUnits(trimmed, currency);

          if (parsed === null) {
            setInvalid(true);

            return;
          }

          onConfirm(parsed.minorUnits);
        }}
      />

      <Button
        label={t('savings.goal.delete')}
        variant="ghost"
        loading={deleting}
        onPress={onDelete}
      />
    </Card>
  );
}

export default function Savings(): ReactNode {
  const { t, i18n } = useTranslation();
  const locale = intlLocale(i18n.language);
  const dashboard = useDashboard();
  const goals = useSavingsGoals();
  const createGoal = useCreateSavingsGoal();
  const updateGoal = useUpdateSavingsGoal();
  const deleteGoal = useDeleteSavingsGoal();

  const [target, setTarget] = useState('');
  const [targetInvalid, setTargetInvalid] = useState(false);

  if (dashboard.isLoading || goals.isLoading) {
    return (
      <Screen title={t('savings.title')}>
        <LoadingState />
      </Screen>
    );
  }

  if (dashboard.isError || dashboard.data === undefined) {
    return (
      <Screen title={t('savings.title')}>
        <ErrorState
          message={errorMessage(dashboard.error, t)}
          onRetry={() => {
            void dashboard.refetch();
          }}
        />
      </Screen>
    );
  }

  const savings = dashboard.data.savings;
  const currency = savings.potential.currency;
  const goalList = goals.data ?? [];

  return (
    <Screen title={t('savings.title')}>
      <Card>
        <Pill label={t('savings.potential')} tone="warning" />
        <Text className="text-3xl font-bold text-ink">
          {formatMoney(savings.potential, locale)}
        </Text>
        <Text className="text-sm text-ink-muted">{t('savings.potentialHint')}</Text>
      </Card>

      <Card>
        <Pill label={t('savings.confirmed')} tone="positive" />
        <Text className="text-3xl font-bold text-ink">
          {formatMoney(savings.confirmed, locale)}
        </Text>
        <Text className="text-sm text-ink-muted">{t('savings.confirmedHint')}</Text>
      </Card>

      <SectionTitle>{t('savings.goal.title')}</SectionTitle>

      {createGoal.isError ? <ErrorState message={errorMessage(createGoal.error, t)} /> : null}
      {updateGoal.isError ? <ErrorState message={errorMessage(updateGoal.error, t)} /> : null}
      {deleteGoal.isError ? <ErrorState message={errorMessage(deleteGoal.error, t)} /> : null}
      {goals.isError ? <ErrorState message={errorMessage(goals.error, t)} /> : null}

      {savings.goalProgressPercentage === null ? null : (
        <Card>
          {/* Le pourcentage est calculé par le serveur : l'écran l'affiche et
              en déduit uniquement une largeur de barre (CLAUDE.md §5.1). */}
          <Text className="text-sm font-medium text-ink-muted">
            {t('savings.goal.progress', { value: `${savings.goalProgressPercentage} %` })}
          </Text>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t('savings.goal.progress', {
              value: `${savings.goalProgressPercentage} %`,
            })}
            className="h-3 w-full overflow-hidden rounded-full bg-surface-muted"
          >
            <View
              className="h-full rounded-full bg-positive"
              style={{ width: `${Number(savings.goalProgressPercentage)}%` }}
            />
          </View>
        </Card>
      )}

      {goalList.length === 0 ? (
        <EmptyState title={t('savings.goal.none')} description={t('savings.goal.noneHint')} />
      ) : (
        goalList.map((goal) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            locale={locale}
            confirming={updateGoal.isPending}
            deleting={deleteGoal.isPending}
            onConfirm={(achievedMinorUnits) => {
              // Confirmation **explicite** : c'est le seul chemin vers une
              // économie confirmée (§8). Le serveur en dérive le statut.
              updateGoal.mutate({
                id: goal.id,
                input: { achievedAmount: { minorUnits: achievedMinorUnits, currency } },
              });
            }}
            onDelete={() => {
              deleteGoal.mutate(goal.id);
            }}
          />
        ))
      )}

      <Card title={t('savings.goal.create')}>
        <TextField
          label={t('savings.goal.targetLabel', { currency })}
          hint={t('savings.goal.createHint')}
          value={target}
          onChangeText={(next) => {
            setTarget(next);
            setTargetInvalid(false);
          }}
          error={targetInvalid ? t('transactions.manual.amountError') : undefined}
        />
        <Button
          label={t('savings.goal.create')}
          loading={createGoal.isPending}
          onPress={() => {
            const parsed = parseAmountToMinorUnits(target, currency);

            if (parsed === null) {
              setTargetInvalid(true);

              return;
            }

            createGoal.mutate(
              { targetAmount: { minorUnits: parsed.minorUnits, currency } },
              {
                onSuccess: () => {
                  setTarget('');
                },
              },
            );
          }}
        />
      </Card>

      <SectionTitle>{t('savings.actions.title')}</SectionTitle>
      <Card>
        {dashboard.data.priceAlerts.length === 0 ? (
          <Text className="text-base text-ink-muted">{t('savings.actions.empty')}</Text>
        ) : (
          dashboard.data.priceAlerts.map((alert) => (
            <Text key={alert.expenseId} className="py-1 text-base text-ink">
              {t('dashboard.priceAlert', {
                merchant: alert.merchant,
                previous: formatMoney(alert.previousAmount, locale),
                current: formatMoney(alert.currentAmount, locale),
                percentage: `+${alert.increasePercentage} %`,
              })}
            </Text>
          ))
        )}
      </Card>

      <Notice title={t('savings.scopeNotice')} />
    </Screen>
  );
}
