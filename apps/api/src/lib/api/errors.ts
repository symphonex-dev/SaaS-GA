import { ERROR_CODES, type ErrorCode } from '@subscription-manager/shared';

/**
 * Erreur applicative portant un code stable (`specs/auth-comptes-rgpd.md` §7).
 *
 * Le `message` est technique et non localisé : le client affiche un texte issu
 * de son i18n à partir du `code`. Aucun message ne doit contenir de secret ni
 * révéler l'existence d'un compte.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly field: string | undefined;

  constructor(code: ErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.field = field;
  }
}

/** Correspondance code applicatif → statut HTTP. */
const HTTP_STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  [ERROR_CODES.VALIDATION_ERROR]: 400,
  [ERROR_CODES.RATE_LIMITED]: 429,
  [ERROR_CODES.INTERNAL_ERROR]: 500,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.AUTH_UNAUTHORIZED]: 401,
  [ERROR_CODES.AUTH_INVALID_CREDENTIALS]: 401,
  [ERROR_CODES.AUTH_EMAIL_ALREADY_EXISTS]: 409,
  [ERROR_CODES.AUTH_RESET_TOKEN_INVALID]: 400,
  [ERROR_CODES.AUTH_RESET_TOKEN_EXPIRED]: 400,
  [ERROR_CODES.ACCOUNT_DELETION_BLOCKED_ACTIVE_SUBSCRIPTION]: 409,
  [ERROR_CODES.IMPORT_FILE_INVALID]: 400,
  [ERROR_CODES.IMPORT_FILE_TOO_LARGE]: 413,
  [ERROR_CODES.IMPORT_FILE_TOO_MANY_ROWS]: 413,
  [ERROR_CODES.IMPORT_FILE_TOO_MANY_PAGES]: 413,
  [ERROR_CODES.IMPORT_DELIMITER_AMBIGUOUS]: 409,
  [ERROR_CODES.IMPORT_MAPPING_REQUIRED]: 400,
  [ERROR_CODES.IMPORT_PREVIEW_EXPIRED]: 410,
  [ERROR_CODES.IMPORT_BATCH_ALREADY_ROLLED_BACK]: 409,
  [ERROR_CODES.IMPORT_PDF_REQUIRES_PLUS]: 402,
  [ERROR_CODES.IMPORT_QUOTA_REACHED]: 402,
  [ERROR_CODES.ADMIN_FORBIDDEN]: 403,
  [ERROR_CODES.AI_QUOTA_EXCEEDED]: 402,
  [ERROR_CODES.AI_UNAVAILABLE]: 503,
  [ERROR_CODES.BILLING_PRODUCT_UNKNOWN]: 400,
  [ERROR_CODES.BILLING_VERIFICATION_FAILED]: 402,
  [ERROR_CODES.BILLING_PURCHASE_ALREADY_LINKED]: 409,
  [ERROR_CODES.BILLING_STORE_UNAVAILABLE]: 503,
  [ERROR_CODES.WEBHOOK_SIGNATURE_INVALID]: 401,
};

export function httpStatusForErrorCode(code: ErrorCode): number {
  return HTTP_STATUS_BY_CODE[code];
}

/** Erreurs prêtes à l'emploi, pour garder des messages identiques partout. */
export const AuthErrors = {
  unauthorized: (): AppError =>
    new AppError(ERROR_CODES.AUTH_UNAUTHORIZED, 'Authentification requise.'),

  /**
   * Message volontairement identique pour un e-mail inconnu et un mot de passe
   * erroné : aucune énumération de comptes possible (§4).
   */
  invalidCredentials: (): AppError =>
    new AppError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Identifiants invalides.'),

  emailAlreadyExists: (): AppError =>
    new AppError(ERROR_CODES.AUTH_EMAIL_ALREADY_EXISTS, 'Adresse e-mail déjà utilisée.', 'email'),

  resetTokenInvalid: (): AppError =>
    new AppError(
      ERROR_CODES.AUTH_RESET_TOKEN_INVALID,
      'Token de réinitialisation invalide.',
      'token',
    ),

  resetTokenExpired: (): AppError =>
    new AppError(
      ERROR_CODES.AUTH_RESET_TOKEN_EXPIRED,
      'Token de réinitialisation expiré.',
      'token',
    ),

  rateLimited: (retryAfterSeconds: number): AppError =>
    new AppError(
      ERROR_CODES.RATE_LIMITED,
      `Trop de tentatives. Réessayez dans ${String(retryAfterSeconds)} secondes.`,
    ),

  deletionBlockedByActiveSubscription: (): AppError =>
    new AppError(
      ERROR_CODES.ACCOUNT_DELETION_BLOCKED_ACTIVE_SUBSCRIPTION,
      'Résiliez votre abonnement payant avant de supprimer votre compte. La résiliation débloque la suppression immédiatement, sans attendre la fin de la période déjà payée.',
    ),
} as const;
