const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

/**
 * Configuration Metro pour un **monorepo** npm workspaces.
 *
 * ## Pourquoi ce fichier ne se contente pas du défaut
 *
 * Metro applique la résolution hiérarchique de Node : un paquet hissé à la
 * racine (`node_modules/expo-router`, `node_modules/react-native-css-interop`…)
 * résout ses propres dépendances depuis `<racine>/node_modules`, tandis que le
 * code de `apps/mobile` les résout depuis `apps/mobile/node_modules`.
 *
 * Or npm hisse la version la plus permissive de l'arbre. Ici, l'outillage
 * d'Expo (`@expo/ui`, `react-native-drawer-layout`) tire
 * `react-native-reanimated@4.6` / `react-native-worklets@0.12`, alors qu'Expo
 * SDK 57 — et donc Expo Go — embarque la partie native de `4.5` / `0.10`.
 * Résultat sans cette configuration : le bundle peut embarquer **deux copies**
 * de `react` ou de `react-native-worklets`, et le contrôle de version natif de
 * Worklets (`checkCppVersion()`) **lève une erreur au démarrage**. Expo Router
 * l'attrape et affiche « Something went wrong ».
 *
 * ## Ce que fait la correction
 *
 * `watchFolders` étend la surveillance au dépôt entier — `packages/shared` est
 * consommé en TypeScript source, sans étape de build (CLAUDE.md §10.1).
 *
 * `resolveRequest` force les paquets à **instance unique** à être résolus comme
 * s'ils étaient demandés depuis `apps/mobile`, quel que soit le module qui les
 * demande. La version épinglée par l'application — celle qu'Expo Go embarque —
 * est donc la seule présente dans le graphe.
 *
 * La résolution hiérarchique reste **active** : npm imbrique certaines
 * dépendances (`node_modules/expo/node_modules/expo-modules-core`), et les
 * désactiver rendrait ces modules introuvables.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/**
 * Paquets qui doivent exister en **un seul exemplaire** dans le bundle.
 *
 * `react` : deux copies cassent les crochets React.
 * `react-native` : deux copies cassent le pont natif.
 * `react-native-reanimated` / `react-native-worklets` : leur partie JS doit
 * correspondre à la partie native embarquée par le runtime (Expo Go ou
 * development build), sans quoi le contrôle de version lève.
 */
const SINGLETON_PACKAGES = [
  'react',
  'react-dom',
  'react-native',
  'react-native-reanimated',
  'react-native-worklets',
];

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Point d'origine fictif situé à la racine de l'application : la résolution
// hiérarchique démarre donc à `apps/mobile/node_modules`.
const singletonOrigin = path.join(projectRoot, 'metro.config.js');
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  const isSingleton = SINGLETON_PACKAGES.some(
    (name) => moduleName === name || moduleName.startsWith(`${name}/`),
  );

  if (!isSingleton) {
    return resolve(context, moduleName, platform);
  }

  return resolve({ ...context, originModulePath: singletonOrigin }, moduleName, platform);
};

// `global.css` porte les directives Tailwind : Metro les compile pour NativeWind.
module.exports = withNativeWind(config, { input: './global.css' });
