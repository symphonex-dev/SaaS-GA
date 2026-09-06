import type { Currency, ExpenseCategory } from '@subscription-manager/shared';

import { isoDateToDateTime, parseAmountToMinorUnits } from './money-input';

/**
 * Validation de la saisie manuelle d'une transaction
 * (`specs/ui-composants-mobile.md` §10).
 *
 * ⚠️ Ce n'est **pas** la validation qui fait foi. Celle-ci est côté serveur
 * (`createExpenseSchema` / `updateExpenseSchema` de `packages/shared`, exécutés
 * par la route). Ici, on vérifie seulement que la saisie est transcriptible —
 * montant exprimable dans la devise, date réelle — pour éviter un aller-retour
 * réseau inutile. Aucun montant n'est calculé (CLAUDE.md §5.1).
 */
export interface ExpenseFormValues {
  merchant: string;
  amount: string;
  date: string;
  category: ExpenseCategory;
  notes: string;
}

export interface ExpenseFormErrors {
  merchant?: string;
  amount?: string;
  date?: string;
}

export function validateExpenseForm(
  values: ExpenseFormValues,
  currency: Currency,
  options: { merchantOptional?: boolean } = {},
): ExpenseFormErrors {
  const errors: ExpenseFormErrors = {};

  // Sur une ligne importée, un libellé vide est légitime : il signifie
  // « conserver le libellé du relevé » (`merchantOverride` reste nul).
  if (options.merchantOptional !== true && values.merchant.trim().length === 0) {
    errors.merchant = 'merchant';
  }

  if (parseAmountToMinorUnits(values.amount, currency) === null) {
    errors.amount = 'amount';
  }

  if (isoDateToDateTime(values.date) === null) {
    errors.date = 'date';
  }

  return errors;
}

export function isExpenseFormValid(errors: ExpenseFormErrors): boolean {
  return Object.keys(errors).length === 0;
}
