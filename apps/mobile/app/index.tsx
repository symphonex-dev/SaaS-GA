import type { ReactNode } from 'react';
import { View } from 'react-native';

import { LoadingState } from '../components/states';

/**
 * Écran de démarrage (`specs/ui-composants-mobile.md` §3).
 *
 * Il n'affiche rien de fonctionnel : il patiente pendant la validation de la
 * session par `GET /api/auth/session`, puis la garde du layout racine oriente
 * vers l'onboarding (aucune session) ou vers le tableau de bord.
 *
 * La redirection n'est **pas** faite ici : elle est centralisée dans la garde,
 * pour qu'une seule règle décide de l'accès (CLAUDE.md §5.14).
 */
export default function Index(): ReactNode {
  return (
    <View className="flex-1 items-center justify-center bg-surface-muted">
      <LoadingState />
    </View>
  );
}
