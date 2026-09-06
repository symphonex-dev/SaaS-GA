import * as SecureStore from 'expo-secure-store';

/**
 * Stockage du token de session (`specs/auth-comptes-rgpd.md` §4 et §10).
 *
 * Le token brut n'existe **que** dans `expo-secure-store` — jamais dans
 * `AsyncStorage`, jamais dans un état React persisté, jamais dans un journal.
 * Côté serveur, seule son empreinte SHA-256 est stockée.
 */
const SESSION_TOKEN_KEY = 'subscription-manager.session-token';

export async function readSessionToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  } catch {
    // Trousseau indisponible (appareil verrouillé, réinstallation) : on se
    // comporte comme si aucune session n'existait plutôt que de planter.
    return null;
  }
}

export async function writeSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/**
 * Efface le token local. La déconnexion réelle passe d'abord par
 * `POST /api/auth/logout`, qui révoque la session côté serveur : supprimer le
 * token ici ne suffirait pas à invalider la session.
 */
export async function clearSessionToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  } catch {
    // Rien à effacer : l'état visé (aucun token) est déjà atteint.
  }
}
