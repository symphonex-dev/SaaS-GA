import Constants from 'expo-constants';

/**
 * Version affichée de l'application.
 *
 * Elle est lue depuis la configuration Expo (`app.config.ts`), jamais recopiée
 * dans un écran : deux sources de vérité divergeraient au premier changement de
 * version. Le numéro de build (`versionCode` / `buildNumber`) n'est pas exposé
 * ici — il est géré à distance par EAS et n'a pas de sens pour l'utilisateur.
 */
export function appVersion(): string {
  const version: unknown = Constants.expoConfig?.version;

  return typeof version === 'string' && version.length > 0 ? version : '—';
}
