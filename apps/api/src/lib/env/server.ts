import { z } from 'zod';

/**
 * Configuration serveur validée au démarrage.
 *
 * Ce module ne doit JAMAIS être importé depuis `apps/mobile` ni depuis un
 * composant client : il donne accès à des paramètres serveur
 * (`specs/auth-comptes-rgpd.md` §10).
 *
 * `DATABASE_URL` n'est volontairement pas déclaré ici : il est lu directement
 * par Prisma (`prisma/schema.prisma`), et l'exiger dans ce module obligerait
 * les tests unitaires à disposer d'une base.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * Durée de vie d'une session, en jours. Longue mais finie, renouvelée à
   * chaque usage (fenêtre glissante) — §4.
   */
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(90),

  /** Durée de vie d'un token de réinitialisation, en minutes. Courte — §5. */
  AUTH_PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(240).default(30),

  /**
   * Transport e-mail (`specs/auth-comptes-rgpd.md` §5).
   *
   * `noop` n'envoie rien (défaut de développement) ; `console` écrit le lien de
   * réinitialisation dans la sortie standard et est refusé en production ;
   * `resend` envoie réellement le message par l'API HTTP du fournisseur.
   * Voir `src/lib/mail/mailer.ts`.
   */
  EMAIL_PROVIDER: z.enum(['noop', 'console', 'resend']).default('noop'),

  /**
   * Clé d'API du fournisseur. Secret : elle ne quitte jamais `apps/api`, n'est
   * jamais journalisée, et aucune variable `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` ne
   * doit la porter.
   */
  EMAIL_PROVIDER_API_KEY: z.string().default(''),

  /** Expéditeur, au format « Nom <adresse> » ou « adresse ». */
  EMAIL_FROM: z.string().default(''),

  /** Adresse de réponse. Vide = les réponses vont à `EMAIL_FROM`. */
  EMAIL_REPLY_TO: z.string().default(''),

  /** Base de l'API du fournisseur (surchargée en test ou pour un proxy interne). */
  EMAIL_API_BASE_URL: z.string().default('https://api.resend.com'),

  /** Délai maximal d'un envoi : un fournisseur lent ne bloque jamais une requête. */
  EMAIL_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),

  /** Base du lien de réinitialisation envoyé par e-mail (deep link mobile). */
  PASSWORD_RESET_URL_BASE: z.string().default('subscription-manager://reset-password'),

  // --- Import de relevés (`specs/import-releves.md` §3) ---------------------
  /** Taille maximale d'un fichier importé. Défaut : 10 MiB. */
  MAX_IMPORT_FILE_SIZE_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024)
    .default(10 * 1024 * 1024),

  /** Nombre maximal de lignes de données dans un CSV. */
  MAX_CSV_ROWS: z.coerce.number().int().min(1).max(1_000_000).default(10_000),

  /** Nombre maximal de pages dans un PDF. */
  MAX_PDF_PAGES: z.coerce.number().int().min(1).max(500).default(30),

  /**
   * Durée de validité d'un aperçu d'import, en minutes. Passé ce délai, la
   * confirmation est refusée et l'utilisateur doit relancer l'import.
   */
  IMPORT_PREVIEW_TTL_MINUTES: z.coerce.number().int().min(1).max(240).default(30),

  /**
   * Emplacement des aperçus d'import entre `preview` et `confirm`.
   *
   * `memory` ne convient qu'à une instance unique : avec plusieurs process, la
   * confirmation doit atteindre celui qui a produit l'aperçu, ce qui échoue une
   * fois sur deux. `postgres` est **obligatoire en production** — la contrainte
   * est vérifiée au démarrage (`src/instrumentation.ts`).
   */
  IMPORT_PREVIEW_STORE: z.enum(['memory', 'postgres']).default('memory'),

  /**
   * Emplacement des compteurs de rate limiting.
   *
   * `memory` compte par process : avec N instances, la limite réelle est N fois
   * la limite annoncée. `postgres` partage le compteur et est **obligatoire en
   * production**.
   */
  RATE_LIMIT_STORE: z.enum(['memory', 'postgres']).default('memory'),

  // --- Administration du comparateur (A.8) ---------------------------------
  /**
   * Liste blanche d'adresses administratrices, séparées par des virgules.
   *
   * Le rôle n'est jamais porté par une donnée modifiable par le client
   * (`specs/comparateur-et-assistant-ia.md` A.8). Vide par défaut : sans
   * configuration explicite, aucune route d'administration n'est accessible.
   */
  ADMIN_EMAILS: z.string().default(''),

  // --- Assistant IA borné (B.4) --------------------------------------------
  /**
   * Provider injecté par configuration, jamais codé en dur (B.3).
   * `none` désactive l'IA : l'application reste intégralement utilisable.
   */
  AI_PROVIDER: z.enum(['none', 'mock', 'openai']).default('none'),
  AI_MODEL: z.string().default(''),

  /**
   * Clé du provider. Elle ne vit **que** dans `apps/api` : aucune variable
   * `NEXT_PUBLIC_*` ni aucun champ de configuration mobile ne doit la porter
   * (B.4, CLAUDE.md §2.3).
   */
  AI_API_KEY: z.string().default(''),

  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(4096).default(512),

  /**
   * Crédits mensuels par offre. Valeurs par défaut alignées sur la matrice
   * d'entitlements (`specs/paiement-in-app.md` §2) ; l'environnement peut les
   * ajuster sans toucher au code.
   */
  AI_MONTHLY_CREDITS_FREE: z.coerce.number().int().min(0).max(10_000).default(3),
  AI_MONTHLY_CREDITS_PLUS: z.coerce.number().int().min(0).max(10_000).default(30),

  /** Délai maximal d'un appel provider : une IA lente ne bloque jamais l'app. */
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),

  /** Base de l'API du provider (surchargée en test ou pour un proxy interne). */
  AI_BASE_URL: z.string().default('https://api.openai.com/v1'),

  // --- Paiement in-app (`specs/paiement-in-app.md` §3) ----------------------
  // Aucun secret de store n'est jamais exposé à `apps/mobile`. Aucune variable
  // Stripe n'existe : la facturation passe exclusivement par les stores.
  GOOGLE_PLAY_PACKAGE_NAME: z.string().default(''),
  /** Clé de compte de service, au format JSON tel que fourni par Google. */
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: z.string().default(''),
  GOOGLE_PLAY_PLUS_MONTHLY_PRODUCT_ID: z.string().default(''),
  GOOGLE_PLAY_PLUS_YEARLY_PRODUCT_ID: z.string().default(''),
  /**
   * Jeton de vérification des notifications Pub/Sub (`?token=`). Vide =
   * aucune notification Google n'est acceptée : la sécurité échoue fermée.
   */
  GOOGLE_PLAY_PUBSUB_VERIFICATION_TOKEN: z.string().default(''),

  APP_STORE_BUNDLE_ID: z.string().default(''),
  APP_STORE_ISSUER_ID: z.string().default(''),
  APP_STORE_KEY_ID: z.string().default(''),
  /** Clé privée ES256 (PEM) de l'App Store Server API. */
  APP_STORE_PRIVATE_KEY: z.string().default(''),
  APP_STORE_PLUS_MONTHLY_PRODUCT_ID: z.string().default(''),
  APP_STORE_PLUS_YEARLY_PRODUCT_ID: z.string().default(''),
  /**
   * Certificat racine Apple (DER en base64), publié par Apple et **jamais**
   * généré par nous. Sans lui, aucune notification Apple n'est acceptée.
   */
  APP_STORE_ROOT_CA: z.string().default(''),
  /** `true` en bac à sable : l'App Store Server API a une base distincte. */
  APP_STORE_SANDBOX: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  /**
   * Secret du job de secours d'expiration (§6). Vide = le job est injoignable,
   * comme toute route d'exploitation non configurée.
   */
  BILLING_CRON_SECRET: z.string().default(''),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached !== null) {
    return cached;
  }

  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    // Ne jamais journaliser les valeurs : uniquement les noms de variables.
    const invalidKeys = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Configuration serveur invalide : ${invalidKeys}`);
  }

  cached = parsed.data;
  return cached;
}

/** Réinitialise le cache — réservé aux tests. */
export function resetServerEnvCache(): void {
  cached = null;
}
