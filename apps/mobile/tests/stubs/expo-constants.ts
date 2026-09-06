/**
 * Double minimal de `expo-constants`.
 *
 * `expoConfig` est mutable : les tests reproduisent l'absence de configuration
 * (build de production) comme la présence d'un hôte Metro (développement).
 */
interface ExpoConfigStub {
  extra?: Record<string, unknown> | undefined;
  hostUri?: string | undefined;
}

const constants: {
  expoConfig: ExpoConfigStub | null;
  expoGoConfig: { debuggerHost?: string } | null;
} = {
  expoConfig: null,
  expoGoConfig: null,
};

export default constants;
