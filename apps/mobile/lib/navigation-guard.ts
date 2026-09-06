/**
 * Garde de navigation (`specs/ui-composants-mobile.md` §3.1, CLAUDE.md §5.14).
 *
 * Décision **pure** : à partir des segments de la route courante et de l'état
 * de session, elle renvoie la destination à imposer, ou `null` si la route est
 * légitime. Aucun accès au routeur ni à React ici — c'est ce qui la rend
 * testable sans simulateur.
 *
 * ⚠️ Cette garde est un **filet de sécurité UX**. L'autorisation réelle reste
 * côté serveur : chaque route API exige `requireUser()` (CLAUDE.md §5.14). Un
 * lien profond vers un écran protégé sans session ne donne donc rien, même si
 * la garde était contournée.
 */
export const ONBOARDING_ENTRY = '/(onboarding)/welcome';
export const AUTHENTICATED_ENTRY = '/(tabs)/dashboard';

/**
 * Groupes accessibles sans session.
 *
 * `legal` s'ajoute aux deux groupes de la spec §3.1 : la politique de
 * confidentialité doit être lisible depuis l'écran de consentement, donc avant
 * toute création de compte, et les boutiques exigent qu'elle soit accessible.
 * Ces écrans sont du contenu statique traduit — ils n'affichent aucune donnée
 * utilisateur et n'appellent aucune route protégée.
 */
export const PUBLIC_SEGMENTS: ReadonlySet<string> = new Set(['(onboarding)', '(auth)', 'legal']);

/**
 * Groupes qu'une session valide ne doit pas garder à l'écran : rester dans
 * l'onboarding ou sur l'écran de connexion après s'être authentifié n'a pas de
 * sens. `legal` en est exclu — ces pages restent consultables connecté.
 */
const PRE_AUTH_SEGMENTS: ReadonlySet<string> = new Set(['(onboarding)', '(auth)']);

export interface GuardInput {
  /** Résultat de `useSegments()` : `[]` pour `/`, `['(auth)','login']`, … */
  segments: readonly string[];
  isAuthenticated: boolean;
  /** `true` tant que `GET /api/auth/session` n'a pas tranché. */
  isSessionLoading: boolean;
}

/**
 * Destination à imposer, ou `null` si la route courante est légitime.
 *
 * Tant que la session est en cours de validation, la garde ne décide rien :
 * rediriger sur une information provisoire provoquerait un aller-retour visible
 * à chaque démarrage.
 */
export function resolveGuardRedirect(input: GuardInput): string | null {
  if (input.isSessionLoading) {
    return null;
  }

  const root = input.segments[0];

  // `/` (écran de démarrage) : il n'affiche rien de fonctionnel, il oriente.
  if (root === undefined) {
    return input.isAuthenticated ? AUTHENTICATED_ENTRY : ONBOARDING_ENTRY;
  }

  if (!input.isAuthenticated) {
    // Aucun écran fonctionnel n'est atteignable sans session — y compris par
    // lien profond vers `/subscription-detail/123` (§3.1).
    return PUBLIC_SEGMENTS.has(root) ? null : ONBOARDING_ENTRY;
  }

  return PRE_AUTH_SEGMENTS.has(root) ? AUTHENTICATED_ENTRY : null;
}
