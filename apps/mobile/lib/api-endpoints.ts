import type {
  CreateExpenseInput,
  CreateSavingsGoalInput,
  UpdateExpenseInput,
  UpdateSavingsGoalInput,
  VerifyPurchaseInput,
} from '@subscription-manager/shared';

import type { RequestOptions } from './api-client';
import { queryKeys } from './query-client';

/**
 * Descripteurs de requête, séparés des hooks.
 *
 * Un hook TanStack Query mêle trois choses : le chemin appelé, la méthode et le
 * corps ; le cache à invalider ; et le cycle de vie React. Les deux premières
 * sont du contrat d'API pur — elles vivent ici, où elles se testent sans
 * moteur de rendu (mission §22).
 *
 * Règles tenues par construction, et vérifiées par les tests :
 *  - aucun descripteur ne transporte `source`, `userId`, `plan`, `status` ni
 *    `currentPeriodEnd` : ces valeurs sont décidées par le serveur
 *    (CLAUDE.md §5.3, `specs/paiement-in-app.md` §1) ;
 *  - aucun ne réécrit `merchantRaw` ni `merchantNormalized` : la correction de
 *    l'utilisateur passe par `merchantOverride` (`specs/import-releves.md` §9) ;
 *  - les trois seules routes IA autorisées sont énumérées ici, et pas ailleurs
 *    (CLAUDE.md §5.6).
 */
export interface ApiCall {
  path: string;
  options: RequestOptions;
}

/* --- Transactions (saisie manuelle, `specs/ui-composants-mobile.md` §10) --- */

export function createExpenseCall(input: CreateExpenseInput): ApiCall {
  return { path: '/api/expenses', options: { method: 'POST', body: input } };
}

export function readExpenseCall(expenseId: string): ApiCall {
  return { path: `/api/expenses/${expenseId}`, options: { method: 'GET' } };
}

/**
 * Seuls les champs corrigeables sont transmis. `merchantOverride` porte la
 * correction de libellé ; le libellé du relevé n'est jamais touché.
 */
export function updateExpenseCall(expenseId: string, input: UpdateExpenseInput): ApiCall {
  return { path: `/api/expenses/${expenseId}`, options: { method: 'PATCH', body: input } };
}

export function deleteExpenseCall(expenseId: string): ApiCall {
  return { path: `/api/expenses/${expenseId}`, options: { method: 'DELETE' } };
}

/* --- Objectifs d'épargne (`specs/ui-composants-mobile.md` §8) -------------- */

export function createSavingsGoalCall(input: CreateSavingsGoalInput): ApiCall {
  return { path: '/api/savings', options: { method: 'POST', body: input } };
}

/** Confirmation d'une économie : action explicite de l'utilisateur, jamais du moteur. */
export function updateSavingsGoalCall(goalId: string, input: UpdateSavingsGoalInput): ApiCall {
  return { path: `/api/savings/${goalId}`, options: { method: 'PATCH', body: input } };
}

export function deleteSavingsGoalCall(goalId: string): ApiCall {
  return { path: `/api/savings/${goalId}`, options: { method: 'DELETE' } };
}

/* --- Assistant IA borné (`specs/comparateur-et-assistant-ia.md` B.2) ------- */

/**
 * Les **trois** usages autorisés, et pas un de plus (CLAUDE.md §5.6).
 *
 * Liste fermée : aucune autre route IA n'est appelable depuis le mobile.
 */
export const AI_TASK_ENDPOINTS = {
  MONTHLY_SUMMARY: '/api/ai/summary',
  EXPLAIN_INCREASE: '/api/ai/explain-increase',
  RECOMMENDATION: '/api/ai/recommendation',
} as const;

export type AiTaskKey = keyof typeof AI_TASK_ENDPOINTS;

/**
 * Aucun corps : le contexte est constitué côté serveur à partir de chiffres
 * déjà calculés (B.5). Le mobile ne peut donc ni orienter la réponse, ni
 * envoyer de texte libre, ni contourner le quota.
 */
export function aiTaskCall(task: AiTaskKey): ApiCall {
  return { path: AI_TASK_ENDPOINTS[task], options: { method: 'POST' } };
}

/** Lecture du quota : ne consomme aucun crédit (B.8). */
export function aiQuotaCall(): ApiCall {
  return { path: AI_TASK_ENDPOINTS.MONTHLY_SUMMARY, options: { method: 'GET' } };
}

/* --- Achat in-app (`specs/paiement-in-app.md` §4) -------------------------- */

/**
 * Ne transmet que la preuve d'achat délivrée par le store : ni plan, ni statut,
 * ni date de fin de période. Le serveur revérifie le jeton auprès de l'API du
 * store et n'écrit qu'en cas de succès (§1).
 */
export function verifyPurchaseCall(input: VerifyPurchaseInput): ApiCall {
  return { path: '/api/billing/purchase/verify', options: { method: 'POST', body: input } };
}

/* --- Invalidations de cache ------------------------------------------------ */

/**
 * Une écriture sur une dépense change les transactions, les récurrences
 * détectées et tous les KPI — tous recalculés par le serveur (CLAUDE.md §5.1).
 */
export const EXPENSE_WRITE_INVALIDATIONS = [
  queryKeys.expenses,
  queryKeys.subscriptions,
  queryKeys.dashboard,
  queryKeys.savings,
] as const;

/** Une écriture d'objectif change l'économie **confirmée**, un KPI du dashboard. */
export const SAVINGS_WRITE_INVALIDATIONS = [queryKeys.savings, queryKeys.dashboard] as const;

/**
 * Après un achat vérifié, le plan en vigueur et les droits sont **relus** :
 * ils ne sont jamais déduits de la réponse d'achat côté client.
 */
export const PURCHASE_INVALIDATIONS = [
  queryKeys.billing,
  queryKeys.session,
  queryKeys.account,
  queryKeys.dashboard,
] as const;
