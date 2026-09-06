import type { ErrorCode } from '../constants/error-codes';

/**
 * Enveloppe de réponse standard (`specs/auth-comptes-rgpd.md` §7).
 * Toute route de `apps/api` répond exclusivement dans ce format.
 */
export interface ApiErrorBody {
  code: ErrorCode;
  /**
   * Message technique non localisé, sûr à afficher en dernier recours.
   * L'affichage utilisateur passe par l'i18n mobile, à partir du `code`.
   */
  message: string;
  /** Chemin du champ en faute quand `code === 'VALIDATION_ERROR'`. */
  field?: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function isApiError<T>(response: ApiResponse<T>): response is ApiError {
  return response.success === false;
}
