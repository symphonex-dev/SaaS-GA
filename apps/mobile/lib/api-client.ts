import type { ApiResponse, ErrorCode } from '@subscription-manager/shared';
import { Platform } from 'react-native';

import { apiBaseUrlResolution } from './api-config';
import { readSessionToken } from './secure-storage';

/**
 * Client HTTP unique de l'application (`specs/ui-composants-mobile.md` §1).
 *
 * Aucun composant n'appelle `fetch` directement : tout passe par ce client,
 * puis par un hook TanStack Query. Le token de session est lu depuis
 * `expo-secure-store` et transmis en `Authorization: Bearer` — jamais en
 * cookie, jamais en paramètre d'URL.
 *
 * L'URL de base est résolue par `lib/api-config.ts`, qui distingue émulateur,
 * simulateur et appareil physique.
 */
export class ApiError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR';
  readonly field: string | undefined;
  readonly status: number;

  constructor(code: ErrorCode | 'NETWORK_ERROR', message: string, status: number, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Corps multipart déjà construit (import de relevé). */
  formData?: FormData;
  /** `false` pour les routes publiques d'authentification. */
  authenticated?: boolean;
  signal?: AbortSignal;
}

/** Familles de panne réseau distinguables depuis le client (§4 de la mission). */
export type NetworkFailureKind =
  'ABORTED' | 'TIMEOUT' | 'DNS' | 'CONNECTION_REFUSED' | 'TLS' | 'UNREACHABLE';

/**
 * Classe une panne réseau à partir du message de `fetch`.
 *
 * React Native ne fournit pas de code d'erreur structuré : le message brut est
 * la seule information disponible. Il n'est **jamais affiché** à l'utilisateur
 * (§13 : seul le code stable choisit un texte traduit) ni journalisé tel quel.
 */
export function classifyNetworkFailure(error: unknown): NetworkFailureKind {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'ABORTED';
  }

  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (message.includes('timeout') || message.includes('timed out')) {
    return 'TIMEOUT';
  }

  if (
    message.includes('unable to resolve host') ||
    message.includes('nodename nor servname') ||
    message.includes('getaddrinfo') ||
    message.includes('name not resolved')
  ) {
    return 'DNS';
  }

  if (message.includes('connection refused') || message.includes('econnrefused')) {
    return 'CONNECTION_REFUSED';
  }

  if (
    message.includes('ssl') ||
    message.includes('tls') ||
    message.includes('certificate') ||
    message.includes('cleartext')
  ) {
    return 'TLS';
  }

  return 'UNREACHABLE';
}

/**
 * Journal de diagnostic **réservé au développement**.
 *
 * Ce qui est écrit : méthode, URL appelée, code HTTP éventuel, famille de
 * panne, plateforme et provenance de la configuration d'URL.
 *
 * Ce qui n'est **jamais** écrit : en-têtes (donc jamais le `Authorization`),
 * jeton de session, mot de passe, corps de requête ou de réponse, contenu d'un
 * relevé, aucune donnée utilisateur (CLAUDE.md §6). En production, la fonction
 * ne fait rien : le comportement reste celui d'avant.
 */
export function logNetworkDiagnostic(entry: {
  method: string;
  url: string;
  status: number | null;
  failure: NetworkFailureKind | null;
  code?: string;
}): void {
  if (!__DEV__) {
    return;
  }

  const { baseUrl, source } = apiBaseUrlResolution();

  console.warn(
    [
      '[api] requête en échec (diagnostic de développement uniquement)',
      `  méthode        : ${entry.method}`,
      `  url            : ${entry.url}`,
      `  statut HTTP    : ${entry.status === null ? 'aucune réponse' : String(entry.status)}`,
      `  cause réseau   : ${entry.failure ?? 'réponse reçue'}`,
      `  code applicatif: ${entry.code ?? '—'}`,
      `  plateforme     : ${Platform.OS} ${String(Platform.Version)}`,
      `  API configurée : ${baseUrl} (source : ${source})`,
      entry.failure === null
        ? ''
        : "  piste          : sur téléphone physique, 'localhost' désigne le téléphone. " +
          "Lancer l'API avec `npm run dev:api:lan` et vérifier que l'ordinateur et le " +
          'téléphone sont sur le même réseau, ou fixer EXPO_PUBLIC_API_BASE_URL.',
    ]
      .filter((line) => line.length > 0)
      .join('\n'),
  );
}

/**
 * Libellé d'appareil informatif, encodé en pourcent : un en-tête HTTP ne
 * transporte que de l'ASCII.
 */
function deviceLabel(): string {
  return encodeURIComponent(`${Platform.OS} — ${String(Platform.Version)}`);
}

async function buildHeaders(options: RequestOptions): Promise<Headers> {
  const headers = new Headers({ accept: 'application/json', 'x-device-label': deviceLabel() });

  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  if (options.authenticated !== false) {
    const token = await readSessionToken();

    if (token !== null) {
      headers.set('authorization', `Bearer ${token}`);
    }
  }

  return headers;
}

/**
 * Exécute une requête et déballe l'enveloppe `{ success, data }`
 * (`specs/auth-comptes-rgpd.md` §7).
 *
 * Une réponse en erreur lève une `ApiError` portant le **code** stable ; le
 * message affiché à l'utilisateur est produit par l'i18n à partir de ce code,
 * jamais par le texte brut du serveur (§13).
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const url = `${apiBaseUrlResolution().baseUrl}${path}`;

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers: await buildHeaders(options),
      body:
        options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    const failure = classifyNetworkFailure(error);

    logNetworkDiagnostic({ method, url, status: null, failure, code: 'NETWORK_ERROR' });

    // Message générique : le détail reste dans le journal de développement.
    throw new ApiError('NETWORK_ERROR', 'Network request failed', 0);
  }

  // L'export RGPD renvoie un fichier, pas l'enveloppe standard.
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      logNetworkDiagnostic({
        method,
        url,
        status: response.status,
        failure: null,
        code: 'INTERNAL_ERROR',
      });

      throw new ApiError('INTERNAL_ERROR', 'Unexpected response', response.status);
    }

    return (await response.text()) as T;
  }

  const payload = (await response.json()) as ApiResponse<T>;

  if (!payload.success) {
    logNetworkDiagnostic({
      method,
      url,
      status: response.status,
      failure: null,
      code: payload.error.code,
    });

    throw new ApiError(
      payload.error.code,
      payload.error.message,
      response.status,
      payload.error.field,
    );
  }

  return payload.data;
}

/** Requête multipart (import de relevé) : le corps est déjà encodé. */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  return apiRequest<T>(path, { method: 'POST', formData });
}
