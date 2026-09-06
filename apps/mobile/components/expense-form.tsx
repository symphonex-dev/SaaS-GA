import { EXPENSE_CATEGORIES, type Currency } from '@subscription-manager/shared';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, OptionList, TextField } from './controls';
import type { ExpenseFormErrors, ExpenseFormValues } from '../lib/expense-input';

/**
 * Formulaire de transaction manuelle (`specs/ui-composants-mobile.md` §10).
 *
 * Fonction **secondaire** : ajouter une dépense en espèces, une transaction
 * absente du relevé, ou corriger une ligne importée. Elle n'est jamais mise en
 * avant, ni dans l'onboarding, ni comme bouton principal (CLAUDE.md §5.4).
 *
 * Le formulaire ne produit qu'un **payload** : la validation qui fait foi est
 * celle du serveur (`createExpenseSchema` / `updateExpenseSchema` de
 * `packages/shared/validation`, exécutés par la route). Ici, seule la
 * transcription de la saisie est vérifiée — montant exprimable dans la devise,
 * date réelle — pour éviter un aller-retour réseau inutile.
 *
 * Ce que le formulaire **ne peut pas** faire, par construction :
 *  - choisir la source : le serveur écrit `MANUAL` lui-même ;
 *  - réécrire `merchantRaw` / `merchantNormalized` d'une ligne importée : la
 *    correction de libellé passe par `merchantOverride` ;
 *  - fixer un `userId`, un lot d'import ou un identifiant de dépense.
 */
export function ExpenseForm({
  values,
  onChange,
  currency,
  errors,
  /** Libellé du bouton principal — « Ajouter » ou « Enregistrer ». */
  submitLabel,
  onSubmit,
  submitting,
  /** Vrai pour une ligne importée : son libellé d'origine reste intouchable. */
  merchantLocked = false,
}: {
  values: ExpenseFormValues;
  onChange: (next: ExpenseFormValues) => void;
  currency: Currency;
  errors: ExpenseFormErrors;
  submitLabel: string;
  onSubmit: () => void;
  submitting: boolean;
  merchantLocked?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const [showCategories, setShowCategories] = useState(false);

  return (
    <View className="w-full gap-4">
      <TextField
        label={
          merchantLocked
            ? t('transactions.manual.merchantOverride')
            : t('transactions.manual.merchant')
        }
        hint={
          merchantLocked
            ? t('transactions.manual.merchantOverrideHint')
            : t('transactions.manual.merchantHint')
        }
        value={values.merchant}
        onChangeText={(merchant) => {
          onChange({ ...values, merchant });
        }}
        autoCapitalize="sentences"
        error={errors.merchant === undefined ? undefined : t('transactions.manual.merchantError')}
      />

      <TextField
        label={t('transactions.manual.amount', { currency })}
        hint={t('transactions.manual.amountHint')}
        value={values.amount}
        onChangeText={(amount) => {
          onChange({ ...values, amount });
        }}
        error={errors.amount === undefined ? undefined : t('transactions.manual.amountError')}
      />

      <TextField
        label={t('transactions.manual.date')}
        hint={t('transactions.manual.dateHint')}
        value={values.date}
        onChangeText={(date) => {
          onChange({ ...values, date });
        }}
        error={errors.date === undefined ? undefined : t('transactions.manual.dateError')}
      />

      <Button
        label={`${t('transactions.manual.category')} : ${t(`category.${values.category}`)}`}
        variant="secondary"
        onPress={() => {
          setShowCategories(!showCategories);
        }}
      />

      {showCategories ? (
        <OptionList
          label={t('transactions.manual.category')}
          options={EXPENSE_CATEGORIES.map((category) => ({
            value: category,
            label: t(`category.${category}`),
          }))}
          selected={values.category}
          onSelect={(category) => {
            onChange({ ...values, category });
            setShowCategories(false);
          }}
        />
      ) : null}

      <TextField
        label={t('transactions.manual.notes')}
        value={values.notes}
        onChangeText={(notes) => {
          onChange({ ...values, notes });
        }}
        autoCapitalize="sentences"
      />

      <Button label={submitLabel} loading={submitting} onPress={onSubmit} />
    </View>
  );
}
