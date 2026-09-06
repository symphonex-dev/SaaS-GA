/**
 * Double minimal de `expo-secure-store`.
 *
 * Aucun test n'écrit ni ne lit de véritable jeton : le trousseau n'existe pas
 * hors d'un appareil, et un jeton de session n'a rien à faire dans un test.
 */
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY';

export function getItemAsync(): Promise<string | null> {
  return Promise.resolve(null);
}

export function setItemAsync(): Promise<void> {
  // Aucun effet : les tests ne manipulent pas de jeton.
  return Promise.resolve();
}

export function deleteItemAsync(): Promise<void> {
  // Aucun effet.
  return Promise.resolve();
}
