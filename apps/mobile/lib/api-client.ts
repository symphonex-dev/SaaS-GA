import type { ApiResponse, ErrorCode } from '@subscription-manager/shared';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
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
  /** `false` pour les routes publiques d'authentification. */
  authenticated?: boolean;
  signal?: AbortSignal;
}

/** Familles de panne distinguables depuis le client (§4 de la mission). */
export type NetworkFailureKind =
  'ABORTED' | 'TIMEOUT' | 'DNS' | 'CONNECTION_REFUSED' | 'TLS' | 'FILE_UNREADABLE' | 'UNREACHABLE';

/**
 * Classe une panne à partir du message de l'erreur.
 *
 * ⚠️ **Ce que cette fonction peut et ne peut pas voir.** Le `fetch` de React
 * Native (`whatwg-fetch`) rejette avec un `TypeError: Network request failed`
 * **quelle que soit** la panne sous-jacente : le message natif d'Android — DNS
 * introuvable, connexion refusée, trafic en clair interdit — n'atteint jamais
 * le JavaScript. Sur ce chemin, seuls `ABORTED`, `TIMEOUT` et `UNREACHABLE`
 * peuvent donc sortir, et `UNREACHABLE` ne veut dire que « panne non
 * identifiable », jamais « adresse injoignable ».
 *
 * Les autres familles ne sont atteignables que depuis un appel qui **conserve**
 * le message natif — aujourd'hui l'envoi de fichier (`apiUpload`), qui passe
 * par `expo-file-system`. C'est précisément pourquoi il ne repose pas sur
 * `fetch`.
 *
 * Le message brut n'est **jamais affiché** à l'utilisateur (§13 : seul le code
 * stable choisit un texte traduit) ni journalisé sans passer par
 * `redactDiagnosticDetail`.
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

  // « Failed to connect to /192.168.1.136:3000 » est la formulation d'OkHttp
  // aussi bien pour un refus que pour un hôte injoignable.
  if (
    message.includes('connection refused') ||
    message.includes('econnrefused') ||
    message.includes('failed to connect')
  ) {
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

  if (
    message.includes('no such file') ||
    message.includes('does not exist') ||
    message.includes('enoent') ||
    message.includes('unabletoread') ||
    message.includes('permission denied')
  ) {
    return 'FILE_UNREADABLE';
  }

  return 'UNREACHABLE';
}

/**
 * Message natif d'une panne, débarrassé de ce qui pourrait identifier
 * l'utilisateur ou son relevé.
 *
 * Le nom d'un relevé bancaire est une donnée personnelle : il n'a rien à faire
 * dans un journal, même de développement (CLAUDE.md §6). Seules la nature de
 * la panne et l'adresse appelée sont conservées — l'adresse de l'API est déjà
 * journalisée à part, et une adresse IP de réseau local n'identifie personne.
 */
export function redactDiagnosticDetail(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'erreur non standard';
  }

  return error.message
    .replace(/file:\/\/\S*/gi, '<fichier masqué>')
    .replace(/(?:\/[\w.%-]+){2,}/g, '<chemin masqué>')
    .slice(0, 200);
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
  /** Message natif **déjà expurgé** par `redactDiagnosticDetail`. */
  detail?: string;
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
      entry.detail === undefined ? '' : `  message natif  : ${entry.detail}`,
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

async function buildHeaders(options: RequestOptions): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-device-label': deviceLabel(),
  };

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (options.authenticated !== false) {
    const token = await readSessionToken();

    if (token !== null) {
      headers['authorization'] = `Bearer ${token}`;
    }
  }

  return headers;
}

/**
 * Déballe l'enveloppe `{ success, data }` (`specs/auth-comptes-rgpd.md` §7).
 *
 * Partagé par les deux chemins de sortie — requête JSON et envoi de fichier —
 * pour qu'ils produisent exactement la même `ApiError` à partir du même code
 * serveur. Le message brut du serveur n'est jamais affiché (§13).
 */
function unwrapApiPayload<T>(
  payload: ApiResponse<T>,
  status: number,
  method: string,
  url: string,
): T {
  if (!payload.success) {
    logNetworkDiagnostic({ method, url, status, failure: null, code: payload.error.code });

    throw new ApiError(payload.error.code, payload.error.message, status, payload.error.field);
  }

  return payload.data;
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
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
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

  return unwrapApiPayload(payload, response.status, method, url);
}

/** Fichier à envoyer, déjà nommé avec l'extension que le serveur doit lire. */
export interface UploadFile {
  /** URI locale `file://` renvoyée par le sélecteur de documents. */
  uri: string;
  /** Nom **et extension** sous lesquels le fichier part (`importUploadFileName`). */
  uploadName: string;
  mimeType: string;
}

/**
 * Répertoire de transit, à l'intérieur du cache de l'application.
 *
 * Le fichier choisi y est recopié sous un nom correct juste avant l'envoi,
 * puis supprimé — un relevé bancaire n'a pas à séjourner en clair dans le
 * cache (CLAUDE.md §6 : minimisation).
 */
const UPLOAD_STAGING_DIRECTORY = 'statement-uploads';

/**
 * Envoi d'un fichier en `multipart/form-data`.
 *
 * ## Pourquoi pas `fetch` + `FormData`
 *
 * React Native sait envoyer un `FormData` contenant `{ uri, name, type }`,
 * mais ce chemin s'est révélé être le seul à échouer sur appareil physique
 * alors que toutes les autres requêtes passaient. Il a deux propriétés qui le
 * rendent impossible à diagnostiquer :
 *
 * - le corps est construit **avant** l'ouverture de la moindre connexion
 *   (`NetworkingModule.constructMultipartBody`), et le moindre incident —
 *   fichier illisible, type MIME non analysable — interrompt la requête sans
 *   qu'aucun octet ne parte : le serveur reste muet, l'échec est instantané ;
 * - `whatwg-fetch`, le `fetch` de React Native, remplace **toute** erreur
 *   native par `TypeError: Network request failed`. Le message réel n'atteint
 *   jamais le JavaScript, donc aucune classification n'est possible.
 *
 * `expo-file-system` envoie le fichier depuis un `File` natif : la longueur du
 * corps est connue, aucun flux n'est relu, et surtout **l'erreur native
 * remonte telle quelle**. Un échec devient lisible au lieu d'être un
 * `NETWORK_ERROR` muet.
 *
 * Le module est déjà lié à l'application : aucun nouveau build natif n'est
 * nécessaire.
 */
export async function apiUpload<T>(
  path: string,
  file: UploadFile,
  parameters: Record<string, string> = {},
): Promise<T> {
  const url = `${apiBaseUrlResolution().baseUrl}${path}`;
  const headers = await buildHeaders({ method: 'POST' });

  let staged: File;

  try {
    const directory = new Directory(Paths.cache, UPLOAD_STAGING_DIRECTORY);

    directory.create({ intermediates: true, idempotent: true });
    staged = new File(directory, file.uploadName);

    await new File(file.uri).copy(staged, { overwrite: true });
  } catch (error) {
    // Le fichier choisi n'est plus lisible : ce n'est pas une panne réseau, et
    // l'annoncer comme telle enverrait l'utilisateur vérifier son Wi-Fi.
    logNetworkDiagnostic({
      method: 'POST',
      url,
      status: null,
      failure: 'FILE_UNREADABLE',
      code: 'IMPORT_FILE_INVALID',
      detail: redactDiagnosticDetail(error),
    });

    throw new ApiError('IMPORT_FILE_INVALID', 'Local file unreadable', 0, 'file');
  }

  try {
    const result = await staged.upload(url, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: file.mimeType,
      parameters,
      headers,
    });

    let payload: ApiResponse<T>;

    try {
      payload = JSON.parse(result.body) as ApiResponse<T>;
    } catch {
      logNetworkDiagnostic({
        method: 'POST',
        url,
        status: result.status,
        failure: null,
        code: 'INTERNAL_ERROR',
      });

      throw new ApiError('INTERNAL_ERROR', 'Unexpected response', result.status);
    }

    return unwrapApiPayload(payload, result.status, 'POST', url);
  } catch (error) {
    // Une réponse d'erreur du serveur est déjà une `ApiError` portant son code.
    if (error instanceof ApiError) {
      throw error;
    }

    const failure = classifyNetworkFailure(error);

    logNetworkDiagnostic({
      method: 'POST',
      url,
      status: null,
      failure,
      code: 'NETWORK_ERROR',
      detail: redactDiagnosticDetail(error),
    });

    throw new ApiError('NETWORK_ERROR', 'Network request failed', 0);
  } finally {
    try {
      staged.delete();
    } catch {
      // Le cache est de toute façon purgé par le système ; échouer ici
      // masquerait le résultat réel de l'envoi.
    }
  }
}
