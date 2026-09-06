import type { ExpoConfig } from 'expo/config';

/**
 * Configuration Expo (CLAUDE.md §2.3).
 *
 * Ce fichier remplace `app.json` pour une raison : l'URL de l'API doit pouvoir
 * changer sans modifier le code source. Elle est lue au démarrage du bundler
 * depuis `EXPO_PUBLIC_API_BASE_URL` et publiée dans `extra.apiBaseUrl`.
 *
 * ⚠️ `extra` et toute variable `EXPO_PUBLIC_*` sont **inlinées dans le bundle**
 * distribué : seules des valeurs publiques ont le droit d'y figurer. Une URL
 * d'API publique en est une ; une clé, un jeton ou un secret de store n'en est
 * jamais une (CLAUDE.md §2.3 et §6).
 *
 * Quand la variable n'est pas renseignée, la clé est **omise** et
 * `lib/api-config.ts` déduit l'URL de développement de l'hôte Metro — c'est ce
 * qui permet à Expo Go, sur un téléphone physique, d'atteindre l'API qui tourne
 * sur l'ordinateur du développeur. Voir `README.md` § « Lancer le projet ».
 *
 * ## Versions
 *
 * `version` est la version **affichée** (fiche store, écran Paramètres). Le
 * numéro de build — `versionCode` Android, `buildNumber` iOS — n'apparaît nulle
 * part ici : il est géré à distance par EAS (`eas.json`,
 * `cli.appVersionSource: "remote"`, `autoIncrement` en production). Deux
 * sources de vérité pour un numéro de build produisent tôt ou tard une
 * soumission refusée pour version déjà utilisée.
 */
const rawApiBaseUrl: unknown = process.env.EXPO_PUBLIC_API_BASE_URL;
const apiBaseUrl = typeof rawApiBaseUrl === 'string' ? rawApiBaseUrl.trim() : '';

/** Bleu de marque, aligné sur `brand-600` de `tailwind.config.js`. */
const BRAND_COLOR = '#1d4ed8';

const config: ExpoConfig = {
  name: 'Subscription Manager',
  slug: 'subscription-manager',
  scheme: 'subscription-manager',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  // Couleur de fond de la fenêtre pendant les transitions, avant le premier rendu.
  backgroundColor: '#f4f6fa',
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: 'com.subscriptionmanager.app',
    supportsTablet: false,
  },
  android: {
    package: 'com.subscriptionmanager.app',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: BRAND_COLOR,
    },
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
    // Achat in-app direct (Google Play Billing / StoreKit 2) — absent d'Expo Go,
    // chargé de façon isolée par `lib/native-purchases.ts`.
    'expo-iap',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 220,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
        dark: { backgroundColor: '#0f172a' },
      },
    ],
  ],
  experiments: {
    typedRoutes: false,
  },
  extra: {
    // La clé est **omise** quand la variable n'est pas renseignée — et surtout
    // jamais fixée à `http://localhost:3000` : une valeur codée en dur ici
    // gagnerait sur la détection automatique et rendrait l'API injoignable
    // depuis un téléphone physique, pour qui `localhost` désigne le téléphone.
    ...(apiBaseUrl.length > 0 ? { apiBaseUrl } : {}),
  },
};

export default config;
