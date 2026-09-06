import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Suite de tests de `apps/mobile`.
 *
 * Ces tests exercent la **logique pure** du client : résolution de l'URL d'API,
 * garde de navigation, transcription des montants saisis, construction du corps
 * multipart, descripteurs d'appels d'API et parcours d'achat. Ils ne rendent
 * aucun composant : `react-native` n'est pas exécutable hors d'un appareil, et
 * un rendu simulé ne prouverait rien de plus sur ces règles.
 *
 * Les modules natifs consommés par ces fichiers (`react-native`,
 * `expo-constants`, `expo-iap`) sont remplacés par des doubles
 * minimalistes : le code testé reste le code de production.
 *
 * Ce que ces tests **ne remplacent pas** : la recette sur appareil (tailles
 * d'écran, dynamic type, VoiceOver/TalkBack, liens profonds réels) et le bac à
 * sable des boutiques. Voir `CLAUDE.md` §7 phase 6 et phase 8.
 */
export default defineConfig({
  resolve: {
    alias: {
      'react-native': path.resolve(__dirname, 'tests/stubs/react-native.ts'),
      'expo-constants': path.resolve(__dirname, 'tests/stubs/expo-constants.ts'),
      'expo-secure-store': path.resolve(__dirname, 'tests/stubs/expo-secure-store.ts'),
      'expo-iap': path.resolve(__dirname, 'tests/stubs/expo-iap.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
  },
});
