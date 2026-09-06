/**
 * Codes d'erreur applicatifs partagés API ↔ mobile (CLAUDE.md §2.4).
 *
 * Le mobile ne s'appuie jamais sur le message (localisé côté client à partir du
 * code), uniquement sur le code. Les codes ci-dessous sont ceux définis par
 * `specs/auth-comptes-rgpd.md` §7 ; chaque phase ultérieure ajoute les siens
 * ici et nulle part ailleurs (les codes de ligne du parser CSV/PDF, eux,
 * restent locaux au pipeline d'import — voir `specs/import-releves.md`).
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',

  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_EMAIL_ALREADY_EXISTS: 'AUTH_EMAIL_ALREADY_EXISTS',
  AUTH_RESET_TOKEN_INVALID: 'AUTH_RESET_TOKEN_INVALID',
  AUTH_RESET_TOKEN_EXPIRED: 'AUTH_RESET_TOKEN_EXPIRED',

  /** Suppression bloquée uniquement par un abonnement payant actif NON résilié (CLAUDE.md §5.9). */
  ACCOUNT_DELETION_BLOCKED_ACTIVE_SUBSCRIPTION: 'ACCOUNT_DELETION_BLOCKED_ACTIVE_SUBSCRIPTION',

  // Import de relevés (`specs/import-releves.md`). À ne pas confondre avec les
  // codes d'erreur de ligne (`IMPORT_ROW_ERROR_CODES`) : ceux-ci qualifient la
  // requête entière, ceux-là une ligne du fichier.
  IMPORT_FILE_INVALID: 'IMPORT_FILE_INVALID',
  IMPORT_FILE_TOO_LARGE: 'IMPORT_FILE_TOO_LARGE',
  IMPORT_FILE_TOO_MANY_ROWS: 'IMPORT_FILE_TOO_MANY_ROWS',
  IMPORT_FILE_TOO_MANY_PAGES: 'IMPORT_FILE_TOO_MANY_PAGES',
  IMPORT_DELIMITER_AMBIGUOUS: 'IMPORT_DELIMITER_AMBIGUOUS',
  IMPORT_MAPPING_REQUIRED: 'IMPORT_MAPPING_REQUIRED',
  IMPORT_PREVIEW_EXPIRED: 'IMPORT_PREVIEW_EXPIRED',
  IMPORT_BATCH_ALREADY_ROLLED_BACK: 'IMPORT_BATCH_ALREADY_ROLLED_BACK',
  /** Import PDF réservé à l'offre Plus au-delà de l'essai gratuit (§5). */
  IMPORT_PDF_REQUIRES_PLUS: 'IMPORT_PDF_REQUIRES_PLUS',
  /** Quota d'imports de l'offre Free atteint (`specs/paiement-in-app.md` §2). */
  IMPORT_QUOTA_REACHED: 'IMPORT_QUOTA_REACHED',

  // Comparateur & assistant IA (`specs/comparateur-et-assistant-ia.md`).
  /** Endpoint d'administration atteint par un compte non administrateur (A.8). */
  ADMIN_FORBIDDEN: 'ADMIN_FORBIDDEN',
  /** Crédits IA du mois épuisés (B.8). L'application reste entièrement utilisable. */
  AI_QUOTA_EXCEEDED: 'AI_QUOTA_EXCEEDED',
  /** Aucun provider IA configuré ou provider en échec (B.3) : simple enrichissement absent. */
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',

  // Paiement in-app (`specs/paiement-in-app.md`). Aucun code Stripe : la
  // facturation passe exclusivement par Google Play Billing et Apple StoreKit.
  /** Identifiant de produit inconnu de la configuration serveur (§3). */
  BILLING_PRODUCT_UNKNOWN: 'BILLING_PRODUCT_UNKNOWN',
  /** Le store n'a pas confirmé l'achat : aucun plan n'est accordé (§4). */
  BILLING_VERIFICATION_FAILED: 'BILLING_VERIFICATION_FAILED',
  /** L'achat est déjà rattaché à un autre compte : jamais de partage de jeton. */
  BILLING_PURCHASE_ALREADY_LINKED: 'BILLING_PURCHASE_ALREADY_LINKED',
  /** Store injoignable ou non configuré : l'achat n'est ni accordé ni refusé. */
  BILLING_STORE_UNAVAILABLE: 'BILLING_STORE_UNAVAILABLE',
  /** Notification serveur d'un store dont l'authenticité n'est pas établie (§5). */
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
