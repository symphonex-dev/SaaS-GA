import type { ApiResponse } from '@subscription-manager/shared';

/**
 * Helpers de construction de requêtes pour les tests d'intégration.
 * Les route handlers sont appelés directement avec des `Request` standard :
 * c'est exactement ce que Next.js leur transmet à l'exécution.
 */
export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Token opaque placé dans `Authorization: Bearer <token>`. */
  token?: string;
  headers?: Record<string, string>;
}

export function apiRequest(path: string, options: RequestOptions = {}): Request {
  const headers = new Headers({ 'content-type': 'application/json', ...options.headers });

  if (options.token !== undefined) {
    headers.set('authorization', `Bearer ${options.token}`);
  }

  return new Request(`https://api.test${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

export async function readApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  return (await response.json()) as ApiResponse<T>;
}

/** Extrait `data` d'une réponse attendue en succès, ou échoue avec le code d'erreur. */
export async function expectSuccess<T>(response: Response): Promise<T> {
  const body = await readApiResponse<T>(response);

  if (!body.success) {
    throw new Error(`Réponse en erreur inattendue : ${body.error.code}`);
  }

  return body.data;
}

/** Renvoie le code d'erreur d'une réponse attendue en échec. */
export async function expectErrorCode(response: Response): Promise<string> {
  const body = await readApiResponse<unknown>(response);

  if (body.success) {
    throw new Error('Réponse en succès inattendue.');
  }

  return body.error.code;
}
