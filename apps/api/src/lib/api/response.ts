import {
  ERROR_CODES,
  type ApiError,
  type ApiSuccess,
  type ErrorCode,
} from '@subscription-manager/shared';
import { ZodError } from 'zod';

import { AppError, httpStatusForErrorCode } from './errors';

/**
 * Fabriques de réponses HTTP au format standard
 * (`specs/auth-comptes-rgpd.md` §7). Aucune route ne construit de `Response`
 * JSON directement : tout passe par ces helpers.
 */

export function jsonSuccess<T>(data: T, init?: ResponseInit): Response {
  const body: ApiSuccess<T> = { success: true, data };
  return Response.json(body, { status: 200, ...init });
}

export function jsonError(code: ErrorCode, message: string, field?: string): Response {
  const body: ApiError = {
    success: false,
    error: field === undefined ? { code, message } : { code, message, field },
  };
  return Response.json(body, { status: httpStatusForErrorCode(code) });
}

/**
 * Traduit une erreur Zod en réponse `VALIDATION_ERROR`.
 * Seul le chemin du champ fautif est exposé, jamais la valeur reçue — un
 * payload d'authentification contient un mot de passe.
 */
export function zodErrorToResponse(error: ZodError): Response {
  const firstIssue = error.issues[0];
  const field = firstIssue === undefined ? undefined : firstIssue.path.join('.');
  return jsonError(ERROR_CODES.VALIDATION_ERROR, 'Données invalides.', field);
}

/**
 * Convertit n'importe quelle erreur remontée par un handler en réponse.
 * Une erreur inattendue ne fuite jamais son message au client, et n'est
 * journalisée que sous forme de nom de classe (aucune donnée sensible — §10).
 */
export function errorToResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return jsonError(error.code, error.message, error.field);
  }

  if (error instanceof ZodError) {
    return zodErrorToResponse(error);
  }

  console.error(
    'Erreur non gérée dans une route API :',
    error instanceof Error ? error.name : typeof error,
  );

  return jsonError(ERROR_CODES.INTERNAL_ERROR, 'Erreur interne.');
}
