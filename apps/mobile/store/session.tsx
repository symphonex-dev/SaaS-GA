import type { AuthenticatedSessionDto, AuthenticatedUser } from '@subscription-manager/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';

import { ApiError, apiRequest } from '../lib/api-client';
import { changeLanguage } from '../lib/i18n';
import { queryKeys } from '../lib/query-client';
import { clearSessionToken, readSessionToken, writeSessionToken } from '../lib/secure-storage';

/**
 * État de session partagé (`specs/ui-composants-mobile.md` §3.1).
 *
 * La session est validée par `GET /api/auth/session` au démarrage : un token
 * présent dans le trousseau mais révoqué ou expiré côté serveur ne donne aucun
 * accès. La garde de navigation s'appuie sur cet état ; l'autorisation réelle
 * reste côté serveur (`requireUser()`), la garde n'est qu'un filet UX.
 */
interface SessionContextValue {
  user: AuthenticatedUser | null;
  /** `true` tant que `GET /api/auth/session` n'a pas tranché, y compris pendant une revalidation. */
  isLoading: boolean;
  /** Enregistre le token renvoyé par `register`/`login` et rafraîchit l'état. */
  startSession: (session: AuthenticatedSessionDto) => Promise<void>;
  /** Efface l'état local ; la révocation serveur est faite par l'appelant. */
  endSession: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Codes par lesquels le serveur déclare la session inutilisable.
 *
 * Eux seuls justifient d'effacer le trousseau. Une panne réseau, un serveur
 * arrêté ou une erreur 5xx ne disent **rien** de la validité du token :
 * l'effacer dans ces cas déconnecterait définitivement un utilisateur dont la
 * session est parfaitement valide (le cas exact d'une API injoignable depuis
 * un téléphone physique).
 */
const SESSION_REJECTED_CODES: ReadonlySet<string> = new Set([
  'AUTH_UNAUTHORIZED',
  'NOT_FOUND',
  'VALIDATION_ERROR',
]);

async function fetchSession(): Promise<AuthenticatedUser | null> {
  const token = await readSessionToken();

  if (token === null) {
    return null;
  }

  try {
    const data = await apiRequest<{ user: AuthenticatedUser }>('/api/auth/session');

    return data.user;
  } catch (error) {
    if (error instanceof ApiError && SESSION_REJECTED_CODES.has(error.code)) {
      // Token inconnu, expiré ou révoqué : on nettoie le trousseau pour éviter
      // de retenter à chaque écran.
      await clearSessionToken();

      return null;
    }

    // API injoignable ou en panne : le token est conservé, l'application se
    // comporte comme non authentifiée jusqu'au prochain essai réussi.
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: queryKeys.session,
    queryFn: fetchSession,
    staleTime: 60_000,
  });

  const user = data ?? null;

  /**
   * `isFetching` compte comme « en cours de validation », pas seulement le
   * premier chargement. Sans cela, la garde de navigation pourrait trancher
   * entre l'enregistrement du token (`startSession`) et la prise en compte du
   * nouvel utilisateur par React, et renvoyer vers l'onboarding un compte qui
   * vient tout juste d'être créé.
   */
  const isValidating = isLoading || isFetching;

  // La langue de l'interface suit la préférence enregistrée sur le compte :
  // elle ne modifie ni le pays ni la devise (CLAUDE.md §4).
  useEffect(() => {
    if (user !== null) {
      void changeLanguage(user.language);
    }
  }, [user]);

  const startSession = useCallback(
    async (session: AuthenticatedSessionDto) => {
      await writeSessionToken(session.token);
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
    },
    [queryClient],
  );

  const endSession = useCallback(async () => {
    await clearSessionToken();
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<SessionContextValue>(
    () => ({ user, isLoading: isValidating, startSession, endSession }),
    [user, isValidating, startSession, endSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);

  if (context === null) {
    throw new Error('useSession doit être utilisé dans un SessionProvider.');
  }

  return context;
}
