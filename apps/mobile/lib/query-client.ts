import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api-client';

/**
 * Configuration TanStack Query (`specs/ui-composants-mobile.md` §1).
 *
 * Tous les appels réseau passent par un hook : aucun composant n'appelle
 * `fetch` ni `apiRequest` directement.
 */
const MAX_RETRIES = 2;

/**
 * Ne jamais réessayer une erreur que le serveur a déjà tranchée : une session
 * invalide, une validation refusée ou un quota atteint ne changeront pas au
 * deuxième essai — seule une panne réseau ou serveur mérite une nouvelle
 * tentative.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) {
    return false;
  }

  if (error instanceof ApiError) {
    return error.code === 'NETWORK_ERROR' || error.status >= 500;
  }

  return false;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        // Les données financières sont recalculées par le serveur : un cache
        // court évite d'afficher un KPI périmé après un import.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** Clés de cache centralisées : une seule source pour les invalidations. */
export const queryKeys = {
  session: ['session'] as const,
  dashboard: ['dashboard'] as const,
  account: ['account'] as const,
  expenses: ['expenses'] as const,
  expense: (expenseId: string) => ['expense', expenseId] as const,
  subscriptions: ['subscriptions'] as const,
  savings: ['savings'] as const,
  aiQuota: ['ai', 'quota'] as const,
  importBatch: (id: string) => ['import', id] as const,
  comparison: (expenseId: string) => ['comparison', expenseId] as const,
  billing: ['billing'] as const,
} as const;
