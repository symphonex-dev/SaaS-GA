/**
 * Double minimal de `react-native` pour les tests Node.
 *
 * Seule la surface réellement consommée par les modules testés est fournie.
 * `Platform.OS` est mutable pour couvrir Android, iOS et web.
 */
export const Platform: { OS: 'android' | 'ios' | 'web'; Version: string | number } = {
  OS: 'ios',
  Version: '18.0',
};
