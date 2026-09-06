import type { CreateExpenseInput } from '@subscription-manager/shared';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ExpenseForm } from '../../components/expense-form';
import { Screen } from '../../components/layout';
import { ErrorState, LoadingState, Notice } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import {
  isExpenseFormValid,
  validateExpenseForm,
  type ExpenseFormErrors,
  type ExpenseFormValues,
} from '../../lib/expense-input';
import { useAccount, useCreateExpense } from '../../lib/hooks';
import { isoDateToDateTime, parseAmountToMinorUnits } from '../../lib/money-input';

/**
 * Ajouter une transaction manquante (`specs/ui-composants-mobile.md` §10).
 *
 * Atteignable uniquement depuis le lien secondaire de la liste des
 * transactions : jamais depuis l'onboarding, jamais depuis un bouton principal
 * du tableau de bord (CLAUDE.md §5.4). Le parcours de référence reste l'import
 * de relevé.
 *
 * La devise est celle du compte : elle n'est pas choisie ici, et aucune
 * conversion n'existe côté mobile (`specs/calculs-financiers.md` §7).
 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewExpense(): ReactNode {
  const { t } = useTranslation();
  const router = useRouter();
  const account = useAccount();
  const createExpense = useCreateExpense();

  const [values, setValues] = useState<ExpenseFormValues>({
    merchant: '',
    amount: '',
    date: today(),
    category: 'OTHER',
    notes: '',
  });
  const [errors, setErrors] = useState<ExpenseFormErrors>({});

  if (account.isLoading || account.data === undefined) {
    return (
      <Screen title={t('transactions.manual.newTitle')} showBack>
        {account.isError ? (
          <ErrorState
            message={errorMessage(account.error, t)}
            onRetry={() => {
              void account.refetch();
            }}
          />
        ) : (
          <LoadingState />
        )}
      </Screen>
    );
  }

  const currency = account.data.currency;

  function submit(): void {
    const nextErrors = validateExpenseForm(values, currency);

    setErrors(nextErrors);

    const amount = parseAmountToMinorUnits(values.amount, currency);
    const date = isoDateToDateTime(values.date);

    if (!isExpenseFormValid(nextErrors) || amount === null || date === null) {
      return;
    }

    const merchant = values.merchant.trim();
    const notes = values.notes.trim();

    const input: CreateExpenseInput = {
      merchantRaw: merchant,
      // Le serveur renormalise systématiquement le libellé avec la même règle
      // que le pipeline d'import : la valeur envoyée ici n'est jamais retenue
      // telle quelle (`expense.service.ts`, `normalizeMerchant`).
      merchantNormalized: merchant,
      merchantOverride: null,
      amount: { minorUnits: amount.minorUnits, currency },
      date,
      frequency: 'ONCE',
      category: values.category,
      paymentMethod: null,
      notes: notes.length === 0 ? null : notes,
      status: 'ACTIVE',
      // `source` et `importBatchId` sont fixés par le serveur : une écriture par
      // cette route est `MANUAL` par construction, jamais présentable comme une
      // ligne importée.
      source: 'MANUAL',
      importBatchId: null,
    };

    createExpense.mutate(input, {
      onSuccess: () => {
        router.back();
      },
    });
  }

  return (
    <Screen
      title={t('transactions.manual.newTitle')}
      subtitle={t('transactions.manual.subtitle')}
      showBack
    >
      <Notice title={t('transactions.manual.secondaryNotice')} />

      {createExpense.isError ? <ErrorState message={errorMessage(createExpense.error, t)} /> : null}

      <ExpenseForm
        values={values}
        onChange={setValues}
        currency={currency}
        errors={errors}
        submitLabel={t('transactions.manual.submitCreate')}
        submitting={createExpense.isPending}
        onSubmit={submit}
      />
    </Screen>
  );
}
