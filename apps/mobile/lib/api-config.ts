import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Résolution de l'URL de l'API (`specs/ui-composants-mobile.md` §1).
 *
 * Le problème que ce module résout : `localhost` ne désigne pas la même machine
 * selon l'endroit où le bundle s'exécute.
 *
 * | Exécution                     | Ce que `localhost` désigne | URL à viser                |
 * |-------------------------------|----------------------------|----------------------------|
 * | Émulateur Android             | l'émulateur lui-même       | `http://10.0.2.2:3000`     |
 * | Appareil Android physique     | le téléphone               | `http://<IP LAN>:3000`     |
 * | Simulateur iOS                | le Mac hôte                | `http://localhost:3000`    |
 * | Appareil iOS physique         | le téléphone               | `http://<IP LAN>:3000`     |
 * | Navigateur (web)              | l'ordinateur               | `http://localhost:3000`    |
 *
 * Sur un **appareil physique**, l'adresse à viser est celle de l'ordinateur sur
 * le réseau local. Elle n'est jamais codée en dur : elle est déduite de l'hôte
 * Metro auquel Expo Go est déjà connecté (`hostUri`), qui est précisément
 * l'adresse LAN de la machine de développement. Le serveur Next.js doit alors
 * écouter sur cette interface : `npm run dev:api:lan` (voir `README.md`).
 *
 * Ordre de priorité, du plus explicite au plus déduit :
 *  1. `EXPO_PUBLIC_API_BASE_URL` — inlinée au bundling, gagne toujours ;
 *  2. `extra.apiBaseUrl` — alimentée par `app.config.ts` depuis cette variable ;
 *  3. hôte Metro (`hostUri`) — appareil physique et émulateur en développement ;
 *  4. repli par plateforme.
 *
 * ⚠️ Une URL d'API publique n'est pas un secret, mais **aucune clé, aucun jeton
 * et aucun secret serveur** ne doit passer par `EXPO_PUBLIC_*` ni par `extra` :
 * les deux sont inlinés en clair dans le bundle distribué (CLAUDE.md §6).
 */
export const DEFAULT_API_PORT = 3000;

/** Adresse par laquelle l'émulateur Android atteint son hôte. */
export const ANDROID_EMULATOR_HOST = '10.0.2.2';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/** D'où provient l'URL retenue — utile au diagnostic de développement (§4). */
export type ApiBaseUrlSource =
  | 'EXPO_PUBLIC_API_BASE_URL'
  | 'expoConfig.extra.apiBaseUrl'
  | 'metro-host'
  | 'android-emulator-fallback'
  | 'localhost-fallback';

export interface ApiBaseUrlResolution {
  baseUrl: string;
  source: ApiBaseUrlSource;
}

export interface ResolveApiBaseUrlOptions {
  /** Valeur de `process.env.EXPO_PUBLIC_API_BASE_URL`, inlinée au bundling. */
  envUrl?: unknown;
  /** Valeur de `expoConfig.extra.apiBaseUrl`, alimentée par `app.config.ts`. */
  extraUrl?: unknown;
  /** `hostUri` d'Expo : `192.168.1.24:8081` en LAN, `localhost:8081` sinon. */
  hostUri?: string | null | undefined;
  platform: 'android' | 'ios' | 'web' | 'windows' | 'macos';
  /** Port de l'API. Séparé de celui de Metro, qui écoute sur 8081. */
  port?: number;
}

/** Retire les `/` de fin : `apiRequest` concatène un chemin qui commence par `/`. */
export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function usableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = normalizeBaseUrl(value);

  return normalized.length > 0 ? normalized : null;
}

/**
 * Extrait le nom d'hôte d'un `hostUri` (`192.168.1.24:8081`, `localhost:8081`,
 * `exp://192.168.1.24:8081`, `[::1]:8081`). Le port de Metro est ignoré :
 * l'API écoute sur le sien.
 */
export function hostnameFromHostUri(hostUri: string | null | undefined): string | null {
  if (typeof hostUri !== 'string') {
    return null;
  }

  const withoutScheme = hostUri.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const authority = withoutScheme.split('/')[0] ?? '';

  if (authority.length === 0) {
    return null;
  }

  // IPv6 littéral : `[fe80::1]:8081`.
  const bracketed = /^\[([^\]]+)]/.exec(authority);

  if (bracketed?.[1] !== undefined) {
    return bracketed[1];
  }

  const hostname = authority.split(':')[0] ?? '';

  return hostname.length > 0 ? hostname : null;
}

/**
 * Fonction **pure** : aucun accès à `Constants` ni à `Platform`, uniquement ses
 * arguments. C'est ce qui la rend testable pour les cinq contextes d'exécution.
 */
export function resolveApiBaseUrl(options: ResolveApiBaseUrlOptions): ApiBaseUrlResolution {
  const port = options.port ?? DEFAULT_API_PORT;

  const fromEnv = usableString(options.envUrl);

  if (fromEnv !== null) {
    return { baseUrl: fromEnv, source: 'EXPO_PUBLIC_API_BASE_URL' };
  }

  const fromExtra = usableString(options.extraUrl);

  if (fromExtra !== null) {
    return { baseUrl: fromExtra, source: 'expoConfig.extra.apiBaseUrl' };
  }

  const metroHost = hostnameFromHostUri(options.hostUri);

  if (metroHost !== null && !LOOPBACK_HOSTS.has(metroHost)) {
    // Metro est joint par une adresse LAN : c'est celle de l'ordinateur de
    // développement, donc celle par laquelle le téléphone atteint l'API.
    const authority = metroHost.includes(':') ? `[${metroHost}]` : metroHost;

    return { baseUrl: `http://${authority}:${String(port)}`, source: 'metro-host' };
  }

  if (options.platform === 'android') {
    // Metro est joint en boucle locale (`adb reverse`) ou n'est pas connu :
    // sur un émulateur Android, l'hôte est joignable par 10.0.2.2.
    return {
      baseUrl: `http://${ANDROID_EMULATOR_HOST}:${String(port)}`,
      source: 'android-emulator-fallback',
    };
  }

  return { baseUrl: `http://localhost:${String(port)}`, source: 'localhost-fallback' };
}

/**
 * `hostUri` d'Expo. Présent en développement (Expo Go comme development build),
 * absent d'un build de production — auquel cas seule une URL explicite compte.
 */
function expoHostUri(): string | null {
  const fromConfig = Constants.expoConfig?.hostUri;

  if (typeof fromConfig === 'string' && fromConfig.length > 0) {
    return fromConfig;
  }

  // Expo Go publie l'hôte du bundler sous une autre clé selon les versions.
  // `expoGoConfig` est typé `any` : il est ramené à `unknown` avant lecture.
  const expoGoConfig: unknown = Constants.expoGoConfig;
  const debuggerHost: unknown =
    typeof expoGoConfig === 'object' && expoGoConfig !== null
      ? (expoGoConfig as Record<string, unknown>)['debuggerHost']
      : undefined;

  return typeof debuggerHost === 'string' && debuggerHost.length > 0 ? debuggerHost : null;
}

let cached: ApiBaseUrlResolution | null = null;

/** Résolution effective pour l'exécution courante, calculée une seule fois. */
export function apiBaseUrlResolution(): ApiBaseUrlResolution {
  if (cached === null) {
    // `extra` est typé `any` par expo-constants : il est ramené à `unknown` puis
    // restreint explicitement, jamais consommé tel quel (CLAUDE.md §2.6).
    const extra: unknown = Constants.expoConfig?.extra;
    const extraUrl =
      typeof extra === 'object' && extra !== null
        ? (extra as Record<string, unknown>)['apiBaseUrl']
        : undefined;

    // Accès statique obligatoire : c'est cette forme exacte que le plugin
    // Babel d'Expo remplace par la valeur au moment du bundling.
    const envUrl: unknown = process.env.EXPO_PUBLIC_API_BASE_URL;

    cached = resolveApiBaseUrl({
      envUrl,
      extraUrl,
      hostUri: expoHostUri(),
      platform: Platform.OS,
    });
  }

  return cached;
}

export function apiBaseUrl(): string {
  return apiBaseUrlResolution().baseUrl;
}
