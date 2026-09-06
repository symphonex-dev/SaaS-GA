import type { UpdateExpenseInput } from '@subscription-manager/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/controls';
import { ExpenseForm } from '../../components/expense-form';
import { Card, Row, Screen } from '../../components/layout';
import { EmptyState, ErrorState, LoadingState, Notice, Pill } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import {
  isExpenseFormValid,
  validateExpenseForm,
  type ExpenseFormErrors,
  type ExpenseFormValues,
} from '../../lib/expense-input';
import { useDeleteExpense, useExpense, useUpdateExpense } from '../../lib/hooks';
import { intlLocale } from '../../lib/i18n';
import { formatDate } from '../../lib/money';
import {
  dateTimeToIsoDate,
  isoDateToDateTime,
  minorUnitsToInputValue,
  parseAmountToMinorUnits,
} from '../../lib/money-input';

/**
 * Corriger une transaction (`specs/ui-composants-mobile.md` §10).
 *
 * Fonction **secondaire** : corriger une ligne mal lue par l'import, ou
 * supprimer une saisie erronée. Le libellé d'origine du relevé
 * (`merchantRaw` / `merchantNormalized`) n'est jamais réécrit : la correction
 * de l'utilisateur vit dans `merchantOverride`, qui prime à l'affichage comme
 * au regroupement (`specs/import-releves.md` §9). Le serveur applique cette
 * règle ; l'écran la rend visible.
 */
export default function EditExpense(): ReactNode {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = intlLocale(i18n.language);
  const params = useLocalSearchParams<{ id: string }>();
  const expenseId = typeof params.id === 'string' ? params.id : '';

  const expense = useExpense(expenseId);
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();

  const [values, setValues] = useState<ExpenseFormValues | null>(null);
  const [errors, setErrors] = useState<ExpenseFormErrors>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (expense.isLoading) {
    return (
      <Screen title={t('transactions.manual.editTitle')} showBack>
        <LoadingState />
      </Screen>
    );
  }

  if (expense.isError) {
    return (
      <Screen title={t('transactions.manual.editTitle')} showBack>
        <ErrorState
          message={errorMessage(expense.error, t)}
          onRetry={() => {
            void expense.refetch();
          }}
        />
      </Screen>
    );
  }

  if (expense.data === undefined) {
    return (
      <Screen title={t('transactions.manual.editTitle')} showBack>
        <EmptyState title={t('errors.NOT_FOUND')} />
      </Screen>
    );
  }

  const current = expense.data;
  const currency = current.amount.currency;
  const isImported = current.source === 'IMPORT';

  // Valeurs initiales dérivées du DTO serveur, jamais recalculées.
  const formValues: ExpenseFormValues = values ?? {
    merchant: isImported ? (current.merchantOverride ?? '') : current.merchantDisplay,
    amount: minorUnitsToInputValue(current.amount.minorUnits, currency),
    date: dateTimeToIsoDate(current.date),
    category: current.category,
    notes: current.notes ?? '',
  };

  function submit(): void {
    // Une ligne importée peut n'avoir aucun `merchantOverride` : le champ vide
    // est alors légitime, il signifie « garder le libellé du relevé ».
    const nextErrors = validateExpenseForm(formValues, currency, { merchantOptional: isImported });

    setErrors(nextErrors);

    const amount = parseAmountToMinorUnits(formValues.amount, currency);
    const date = isoDateToDateTime(formValues.date);

    if (!isExpenseFormValid(nextErrors) || amount === null || date === null) {
      return;
    }

    const override = formValues.merchant.trim();
    const notes = formValues.notes.trim();

    const input: UpdateExpenseInput = {
      merchantOverride: override.length === 0 ? null : override,
      amount: { minorUnits: amount.minorUnits, currency },
      date,
      category: formValues.category,
      notes: notes.length === 0 ? null : notes,
    };

    updateExpense.mutate(
      { id: current.id, input },
      {
        onSuccess: () => {
          router.back();
        },
      },
    );
  }

  return (
    <Screen title={t('transactions.manual.editTitle')} showBack>
      <Card title={current.merchantDisplay}>
        <View className="flex-row flex-wrap gap-2">
          <Pill label={t(`transactions.source.${current.source}`)} />
          <Pill label={t(`category.${current.category}`)} />
        </View>
        <Row label={t('transactions.manual.originalLabel')} value={current.merchantRaw} />
        <Row
          label={t('subscriptions.fields.lastPayment')}
          value={formatDate(dateTimeToIsoDate(current.date), locale)}
        />
      </Card>

      {isImported ? <Notice title={t('transactions.manual.importedNotice')} /> : null}

      {updateExpense.isError ? <ErrorState message={errorMessage(updateExpense.error, t)} /> : null}
      {deleteExpense.isError ? <ErrorState message={errorMessage(deleteExpense.error, t)} /> : null}

      <ExpenseForm
        values={formValues}
        onChange={setValues}
        currency={currency}
        errors={errors}
        merchantLocked={isImported}
        submitLabel={t('transactions.manual.submitUpdate')}
        submitting={updateExpense.isPending}
        onSubmit={submit}
      />

      <View className="w-full gap-3 pt-2">
        {confirmingDelete ? (
          <>
            <Notice title={t('transactions.manual.deleteConfirm')} tone="warning" />
            <Button
              label={t('transactions.manual.delete')}
              variant="danger"
              loading={deleteExpense.isPending}
              onPress={() => {
                deleteExpense.mutate(current.id, {
                  onSuccess: () => {
                    router.back();
                  },
                });
              }}
            />
            <Button
              label={t('common.back')}
              variant="ghost"
              onPress={() => {
                setConfirmingDelete(false);
              }}
            />
          </>
        ) : (
          <Button
            label={t('transactions.manual.delete')}
            variant="ghost"
            onPress={() => {
              setConfirmingDelete(true);
            }}
          />
        )}
      </View>
    </Screen>
  );
}
