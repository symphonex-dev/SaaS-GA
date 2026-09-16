import type {
  AiAnswerDto,
  AiQuotaDto,
  AiStatusDto,
  AuthenticatedSessionDto,
  ComparisonDto,
  CreateExpenseInput,
  CreateSavingsGoalInput,
  DashboardData,
  ExpenseDto,
  ImportBatchDto,
  ImportConfirmResultDto,
  ImportPreviewDto,
  ImportRollbackResultDto,
  LoginInput,
  ModifyRecurringDetectionInput,
  RecurringDetectionDto,
  RecurringSummaryDto,
  RegisterInput,
  ResetPasswordInput,
  SubscriptionDto,
  UpdateExpenseInput,
  UpdatePreferencesInput,
  UpdateSavingsGoalInput,
  UserDto,
  UserSavingsGoalDto,
  VerifyPurchaseInput,
} from '@subscription-manager/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { apiRequest, apiUpload } from './api-client';
import {
  EXPENSE_WRITE_INVALIDATIONS,
  PURCHASE_INVALIDATIONS,
  SAVINGS_WRITE_INVALIDATIONS,
  aiQuotaCall,
  aiTaskCall,
  createExpenseCall,
  createSavingsGoalCall,
  deleteExpenseCall,
  deleteSavingsGoalCall,
  readExpenseCall,
  updateExpenseCall,
  updateSavingsGoalCall,
  verifyPurchaseCall,
  type AiTaskKey,
} from './api-endpoints';
import type { ImportSource } from './import-state';
import { buildImportUploadParameters, importUploadFileName } from './import-upload';
import { queryKeys } from './query-client';

/**
 * Hooks réseau (`specs/ui-composants-mobile.md` §1).
 *
 * Aucun composant n'appelle `fetch` ni `apiRequest` directement : toute
 * requête passe par un hook déclaré ici, ce qui garde le cache et les
 * invalidations au même endroit.
 */

export function useDashboard(): UseQueryResult<DashboardData> {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => apiRequest<DashboardData>('/api/dashboard'),
  });
}

export function useSubscriptions(): UseQueryResult<RecurringSummaryDto[]> {
  return useQuery({
    queryKey: queryKeys.subscriptions,
    queryFn: async () => {
      const data = await apiRequest<{ subscriptions: RecurringSummaryDto[] }>('/api/recurring');

      return data.subscriptions;
    },
  });
}

export function useExpenses(): UseQueryResult<ExpenseDto[]> {
  return useQuery({
    queryKey: queryKeys.expenses,
    queryFn: async () => {
      const data = await apiRequest<{ expenses: ExpenseDto[] }>('/api/expenses');

      return data.expenses;
    },
  });
}

export function useSavingsGoals(): UseQueryResult<UserSavingsGoalDto[]> {
  return useQuery({
    queryKey: queryKeys.savings,
    queryFn: async () => {
      const data = await apiRequest<{ goals: UserSavingsGoalDto[] }>('/api/savings');

      return data.goals;
    },
  });
}

export function useAccount(): UseQueryResult<UserDto> {
  return useQuery({
    queryKey: queryKeys.account,
    queryFn: async () => {
      const data = await apiRequest<{ user: UserDto }>('/api/account/me');

      return data.user;
    },
  });
}

export function useRegister(): UseMutationResult<AuthenticatedSessionDto, unknown, RegisterInput> {
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      apiRequest<AuthenticatedSessionDto>('/api/auth/register', {
        method: 'POST',
        body: input,
        authenticated: false,
      }),
  });
}

export function useLogin(): UseMutationResult<AuthenticatedSessionDto, unknown, LoginInput> {
  return useMutation({
    mutationFn: (input: LoginInput) =>
      apiRequest<AuthenticatedSessionDto>('/api/auth/login', {
        method: 'POST',
        body: input,
        authenticated: false,
      }),
  });
}

export function useRequestPasswordReset(): UseMutationResult<unknown, unknown, { email: string }> {
  return useMutation({
    mutationFn: (input: { email: string }) =>
      apiRequest<{ message: string }>('/api/auth/request-password-reset', {
        method: 'POST',
        body: input,
        authenticated: false,
      }),
  });
}

/**
 * Déconnexion : la révocation serveur est ce qui rend la déconnexion réelle
 * (`specs/auth-comptes-rgpd.md` §4). L'effacement du token local vient ensuite.
 */
/**
 * Reinitialisation du mot de passe (`specs/auth-comptes-rgpd.md` §5).
 *
 * Le token du lien profond ne fait que transiter : il n'est jamais stocke sur
 * l'appareil. Le succes revoque toutes les sessions cote serveur, y compris
 * celle d'un appareil compromis.
 */
export function useResetPassword(): UseMutationResult<unknown, unknown, ResetPasswordInput> {
  return useMutation({
    mutationFn: (input: ResetPasswordInput) =>
      apiRequest<{ reset: boolean }>('/api/auth/reset-password', {
        method: 'POST',
        body: input,
        authenticated: false,
      }),
  });
}

export function useLogout(): UseMutationResult<unknown, unknown, void> {
  return useMutation({
    mutationFn: () => apiRequest<{ revoked: boolean }>('/api/auth/logout', { method: 'POST' }),
  });
}

export function useUpdatePreferences(): UseMutationResult<
  UserDto,
  unknown,
  UpdatePreferencesInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdatePreferencesInput) => {
      const data = await apiRequest<{ user: UserDto }>('/api/account/preferences', {
        method: 'PATCH',
        body: input,
      });

      return data.user;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.account });
      void queryClient.invalidateQueries({ queryKey: queryKeys.session });
      // Les totaux sont exprimés dans la devise du compte : ils changent avec elle.
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useExportData(): UseMutationResult<string, unknown, void> {
  return useMutation({
    mutationFn: () => apiRequest<string>('/api/account/export'),
  });
}

export function useDeleteAccount(): UseMutationResult<unknown, unknown, void> {
  return useMutation({
    mutationFn: () =>
      apiRequest<{ deleted: boolean }>('/api/account', {
        method: 'DELETE',
        body: { confirmation: 'DELETE_MY_ACCOUNT' },
      }),
  });
}

export interface ImportPreviewVariables {
  uri: string;
  name: string;
  mimeType: string;
  source: ImportSource;
  delimiter?: string;
  dateOrder?: 'DMY' | 'MDY';
  mapping?: { dateColumn: number; descriptionColumn: number; amountColumn: number };
}

/**
 * Envoi du relevé (`specs/import-releves.md` §10).
 *
 * Le fichier part en `multipart/form-data` ; le serveur l'analyse et le
 * supprime immédiatement. Aucun parsing n'a lieu ici.
 *
 * Le nom d'envoi est reconstruit à partir de la nature choisie par
 * l'utilisateur : la copie déposée par le sélecteur de documents porte un nom
 * sans extension, que le contrôle serveur refuse (`importUploadFileName`).
 */
export function useImportPreview(): UseMutationResult<
  ImportPreviewDto,
  unknown,
  ImportPreviewVariables
> {
  return useMutation({
    mutationFn: (variables: ImportPreviewVariables) =>
      apiUpload<ImportPreviewDto>(
        '/api/imports/preview',
        {
          uri: variables.uri,
          uploadName: importUploadFileName(variables.name, variables.source),
          mimeType: variables.mimeType,
        },
        buildImportUploadParameters({
          delimiter: variables.delimiter,
          dateOrder: variables.dateOrder,
          mapping: variables.mapping,
        }),
      ),
  });
}

export interface ImportConfirmVariables {
  importId: string;
  acceptedRows: number[];
  rejectedRows: number[];
  dateOrder?: 'DMY' | 'MDY';
}

export function useImportConfirm(): UseMutationResult<
  ImportConfirmResultDto,
  unknown,
  ImportConfirmVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: ImportConfirmVariables) =>
      apiRequest<ImportConfirmResultDto>('/api/imports/confirm', {
        method: 'POST',
        body: variables,
      }),
    onSuccess: () => {
      // Un import modifie les dépenses, les récurrences et tous les KPI.
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      void queryClient.invalidateQueries({ queryKey: queryKeys.expenses });
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions });
    },
  });
}

export function useImportRollback(): UseMutationResult<ImportRollbackResultDto, unknown, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (batchId: string) =>
      apiRequest<ImportRollbackResultDto>(`/api/imports/${batchId}/rollback`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      void queryClient.invalidateQueries({ queryKey: queryKeys.expenses });
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions });
    },
  });
}

export function useImportBatch(batchId: string): UseQueryResult<ImportBatchDto> {
  return useQuery({
    queryKey: queryKeys.importBatch(batchId),
    queryFn: async () => {
      const data = await apiRequest<{ batch: ImportBatchDto }>(`/api/imports/${batchId}`);

      return data.batch;
    },
    enabled: batchId.length > 0,
  });
}

type DetectionAction = 'confirm' | 'reject';

export function useDetectionAction(): UseMutationResult<
  RecurringDetectionDto,
  unknown,
  { id: string; action: DetectionAction }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, action }) => {
      const data = await apiRequest<{ detection: RecurringDetectionDto }>(
        `/api/recurring/${id}/${action}`,
        { method: 'POST' },
      );

      return data.detection;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useModifyDetection(): UseMutationResult<
  RecurringDetectionDto,
  unknown,
  { id: string } & ModifyRecurringDetectionInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, frequency }) => {
      const data = await apiRequest<{ detection: RecurringDetectionDto }>(`/api/recurring/${id}`, {
        method: 'PATCH',
        body: { frequency },
      });

      return data.detection;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

/**
 * Comparaison d'offres (`specs/comparateur-et-assistant-ia.md` A.7).
 *
 * Coûts, économies et fraîcheur arrivent déjà calculés par le serveur : cet
 * écran n'effectue aucun calcul financier (CLAUDE.md §5.1).
 */
export function useComparison(expenseId: string): UseQueryResult<ComparisonDto> {
  return useQuery({
    queryKey: queryKeys.comparison(expenseId),
    queryFn: () => apiRequest<ComparisonDto>(`/api/comparisons/${expenseId}`),
    enabled: expenseId.length > 0,
  });
}

/**
 * Rejoue le rapprochement sur la base d'offres courante.
 *
 * Aucun prix n'est collecté : la base d'offres est alimentée à la main (A.1).
 */
export function useRefreshComparison(): UseMutationResult<ComparisonDto, unknown, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (expenseId: string) =>
      apiRequest<ComparisonDto>(`/api/comparisons/${expenseId}/refresh`, { method: 'POST' }),
    onSuccess: (comparison) => {
      // Le rapprochement rejoué renvoie la comparaison complète : elle remplace
      // directement l'entrée de cache, sans nouvel aller-retour réseau.
      queryClient.setQueryData(queryKeys.comparison(comparison.expenseId), comparison);
    },
  });
}

/**
 * Offre en vigueur et droits associés (`specs/paiement-in-app.md` §7).
 *
 * Le plan renvoyé est celui **déjà résolu** par le serveur : le mobile ne
 * déduit jamais un droit d'une date de fin de période.
 */
export function useBillingState(): UseQueryResult<{
  subscription: SubscriptionDto;
  plan: 'FREE' | 'PLUS';
}> {
  return useQuery({
    queryKey: queryKeys.billing,
    queryFn: () =>
      apiRequest<{ subscription: SubscriptionDto; plan: 'FREE' | 'PLUS' }>(
        '/api/billing/subscription',
      ),
  });
}

/* -------------------------------------------------------------------------- */
/* Saisie manuelle de transactions (`specs/ui-composants-mobile.md` §10)       */
/* -------------------------------------------------------------------------- */

/**
 * Invalidations communes à toute écriture sur une dépense.
 *
 * Une transaction modifie les dépenses, les récurrences détectées et tous les
 * KPI du tableau de bord — qui sont recalculés par le serveur (CLAUDE.md §5.1).
 */
function useExpenseWritesInvalidation(): () => void {
  const queryClient = useQueryClient();

  return () => {
    for (const queryKey of EXPENSE_WRITE_INVALIDATIONS) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
}

/**
 * Ajoute une transaction absente du relevé (espèces, oubli bancaire).
 *
 * Action **secondaire** : jamais mise en avant, jamais dans l'onboarding
 * (CLAUDE.md §5.4). La ligne créée est marquée `MANUAL` **par le serveur** — le
 * client ne peut pas la faire passer pour une ligne importée.
 */
export function useCreateExpense(): UseMutationResult<ExpenseDto, unknown, CreateExpenseInput> {
  const invalidate = useExpenseWritesInvalidation();

  return useMutation({
    mutationFn: async (input: CreateExpenseInput) => {
      const call = createExpenseCall(input);
      const data = await apiRequest<{ expense: ExpenseDto }>(call.path, call.options);

      return data.expense;
    },
    onSuccess: invalidate,
  });
}

/** Transaction unitaire, pour préremplir le formulaire de correction. */
export function useExpense(expenseId: string): UseQueryResult<ExpenseDto> {
  return useQuery({
    queryKey: queryKeys.expense(expenseId),
    queryFn: async () => {
      const call = readExpenseCall(expenseId);
      const data = await apiRequest<{ expense: ExpenseDto }>(call.path, call.options);

      return data.expense;
    },
    enabled: expenseId.length > 0,
  });
}

/**
 * Corrige une transaction (`specs/import-releves.md` §9).
 *
 * `merchantRaw` et `merchantNormalized` ne sont jamais réécrits : la valeur
 * d'origine du relevé est conservée côté serveur, et la correction de
 * l'utilisateur vit dans `merchantOverride`.
 */
export function useUpdateExpense(): UseMutationResult<
  ExpenseDto,
  unknown,
  { id: string; input: UpdateExpenseInput }
> {
  const queryClient = useQueryClient();
  const invalidate = useExpenseWritesInvalidation();

  return useMutation({
    mutationFn: async ({ id, input }) => {
      const call = updateExpenseCall(id, input);
      const data = await apiRequest<{ expense: ExpenseDto }>(call.path, call.options);

      return data.expense;
    },
    onSuccess: (expense) => {
      queryClient.setQueryData(queryKeys.expense(expense.id), expense);
      invalidate();
    },
  });
}

/** Supprime une transaction saisie ou importée par erreur. */
export function useDeleteExpense(): UseMutationResult<{ deleted: boolean }, unknown, string> {
  const queryClient = useQueryClient();
  const invalidate = useExpenseWritesInvalidation();

  return useMutation({
    mutationFn: (id: string) => {
      const call = deleteExpenseCall(id);

      return apiRequest<{ deleted: boolean }>(call.path, call.options);
    },
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.expense(id) });
      invalidate();
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Objectifs d'épargne (`specs/ui-composants-mobile.md` §8)                    */
/* -------------------------------------------------------------------------- */

/**
 * Une écriture d'objectif change l'économie **confirmée**, qui est un KPI du
 * tableau de bord (`specs/calculs-financiers.md` §6).
 */
function useSavingsWritesInvalidation(): () => void {
  const queryClient = useQueryClient();

  return () => {
    for (const queryKey of SAVINGS_WRITE_INVALIDATIONS) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
}

export function useCreateSavingsGoal(): UseMutationResult<
  UserSavingsGoalDto,
  unknown,
  CreateSavingsGoalInput
> {
  const invalidate = useSavingsWritesInvalidation();

  return useMutation({
    mutationFn: async (input: CreateSavingsGoalInput) => {
      const call = createSavingsGoalCall(input);
      const data = await apiRequest<{ goal: UserSavingsGoalDto }>(call.path, call.options);

      return data.goal;
    },
    onSuccess: invalidate,
  });
}

/**
 * Confirme une économie : l'utilisateur déclare lui-même le montant atteint.
 *
 * C'est le **seul** chemin vers une économie confirmée. Le moteur ne promeut
 * jamais une économie potentielle en économie confirmée (§8 de la spec UI).
 */
export function useUpdateSavingsGoal(): UseMutationResult<
  UserSavingsGoalDto,
  unknown,
  { id: string; input: UpdateSavingsGoalInput }
> {
  const invalidate = useSavingsWritesInvalidation();

  return useMutation({
    mutationFn: async ({ id, input }) => {
      const call = updateSavingsGoalCall(id, input);
      const data = await apiRequest<{ goal: UserSavingsGoalDto }>(call.path, call.options);

      return data.goal;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteSavingsGoal(): UseMutationResult<{ deleted: boolean }, unknown, string> {
  const invalidate = useSavingsWritesInvalidation();

  return useMutation({
    mutationFn: (id: string) => {
      const call = deleteSavingsGoalCall(id);

      return apiRequest<{ deleted: boolean }>(call.path, call.options);
    },
    onSuccess: invalidate,
  });
}

/* -------------------------------------------------------------------------- */
/* Assistant IA borné (`specs/comparateur-et-assistant-ia.md` partie B)        */
/* -------------------------------------------------------------------------- */

// Les trois usages autorisés sont définis — et fermés — dans `api-endpoints`.
export { AI_TASK_ENDPOINTS, type AiTaskKey } from './api-endpoints';

/**
 * Disponibilité de l'assistant et quota mensuel, lus sans consommer de crédit
 * (B.8). `enabled` est décidé par le serveur (`AI_PROVIDER`) : il ne sert qu'à
 * ne pas proposer d'usage voué à l'échec.
 */
export function useAiStatus(): UseQueryResult<AiStatusDto> {
  return useQuery({
    queryKey: queryKeys.aiQuota,
    queryFn: async () => {
      const call = aiQuotaCall();
      // Une API antérieure ne renvoie que `quota` : l'assistant est alors
      // supposé disponible, et le serveur refuse l'appel s'il ne l'est pas.
      const data = await apiRequest<{ enabled?: boolean; quota: AiQuotaDto }>(
        call.path,
        call.options,
      );

      return { enabled: data.enabled !== false, quota: data.quota };
    },
  });
}

/**
 * Déclenche l'un des trois usages autorisés.
 *
 * Le corps est vide : le contexte est constitué **côté serveur** à partir de
 * chiffres déjà calculés (B.5). Le mobile ne transmet aucun fait, aucune
 * dépense, aucune question — il ne peut donc ni orienter la réponse ni
 * contourner le quota, décompté par le serveur avant l'appel au provider.
 */
export function useAiAnswer(): UseMutationResult<AiAnswerDto, unknown, AiTaskKey> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (task: AiTaskKey) => {
      const call = aiTaskCall(task);

      return apiRequest<AiAnswerDto>(call.path, call.options);
    },
    onSuccess: (answer) => {
      // La réponse porte le quota restant : inutile de le redemander. Une
      // réponse obtenue prouve que l'assistant est disponible.
      queryClient.setQueryData<AiStatusDto>(queryKeys.aiQuota, {
        enabled: true,
        quota: answer.quota,
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Achat in-app (`specs/paiement-in-app.md` §4)                                */
/* -------------------------------------------------------------------------- */

/**
 * Transmet au serveur la preuve d'achat délivrée par le store.
 *
 * Le corps ne contient **ni plan, ni statut, ni date de fin de période** : le
 * serveur revérifie le jeton auprès de l'API du store et n'écrit qu'en cas de
 * succès. Le mobile ne décide jamais du plan (§1).
 */
export function useVerifyPurchase(): UseMutationResult<
  { subscription: SubscriptionDto },
  unknown,
  VerifyPurchaseInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: VerifyPurchaseInput) => {
      const call = verifyPurchaseCall(input);

      return apiRequest<{ subscription: SubscriptionDto }>(call.path, call.options);
    },
    onSuccess: () => {
      // Le plan en vigueur et les droits sont relus auprès du serveur : ils ne
      // sont jamais déduits de la réponse d'achat côté client.
      for (const queryKey of PURCHASE_INVALIDATIONS) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}
