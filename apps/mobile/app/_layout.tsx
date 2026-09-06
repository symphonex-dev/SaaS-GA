import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '../global.css';

import { initI18n } from '../lib/i18n';
import { resolveGuardRedirect } from '../lib/navigation-guard';
import { createQueryClient } from '../lib/query-client';
import { ImportProvider } from '../store/import';
import { OnboardingProvider } from '../store/onboarding';
import { SessionProvider, useSession } from '../store/session';

/**
 * Layout racine et garde de navigation
 * (`specs/ui-composants-mobile.md` §3.1).
 *
 * La garde lit le token de `expo-secure-store` et le valide auprès de
 * `GET /api/auth/session` : un token révoqué ou expiré n'ouvre rien.
 *
 * ⚠️ **Le layout racine rend toujours un navigateur, dès le premier rendu.**
 * C'est une exigence d'Expo Router : renvoyer un écran de chargement ou un
 * `<Redirect>` *à la place* du `<Stack>` démonte le navigateur et fait échouer
 * toute navigation ultérieure — l'application affiche alors l'écran
 * « Something went wrong » de la barrière d'erreur d'Expo Router. La
 * redirection passe donc par un effet, jamais par le rendu.
 *
 * ⚠️ Cette garde reste un **filet de sécurité UX**. L'autorisation réelle est
 * côté serveur : chaque route API exige `requireUser()` (CLAUDE.md §5.14).
 */
initI18n();

/**
 * Applique la décision de `resolveGuardRedirect`. Ne rend rien : sa seule
 * responsabilité est de déclencher la navigation, pour que le `<Stack>` reste
 * monté en permanence.
 */
function NavigationGuard(): null {
  const { user, isLoading } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();
  // Naviguer avant que le navigateur racine soit monté lève
  // « Attempted to navigate before mounting the Root Layout component ».
  const isNavigatorReady = navigationState?.key !== undefined;

  useEffect(() => {
    if (!isNavigatorReady) {
      return;
    }

    const destination = resolveGuardRedirect({
      segments,
      isAuthenticated: user !== null,
      isSessionLoading: isLoading,
    });

    if (destination !== null) {
      router.replace(destination);
    }
  }, [isNavigatorReady, segments, user, isLoading, router]);

  return null;
}

export default function RootLayout(): ReactNode {
  const [queryClient] = useState(createQueryClient);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <OnboardingProvider>
            <ImportProvider>
              <StatusBar style="dark" />
              <NavigationGuard />
              {/* Les routes ne sont pas déclarées une à une : Expo Router les
                  enregistre depuis l'arborescence de `app/`. Les déclarer
                  partiellement produisait un avertissement par groupe sans
                  `_layout.tsx` (« No route named "(auth)" exists »). */}
              <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
            </ImportProvider>
          </OnboardingProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
