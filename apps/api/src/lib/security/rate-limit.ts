import { getServerEnv } from '@/lib/env/server';
import { rateLimitRepository } from '@/server/repositories/rate-limit.repository';

/**
 * Rate limiting par domaine (`specs/auth-comptes-rgpd.md` §10, CLAUDE.md §6).
 *
 * Fenêtre fixe, compteur **partagé entre instances**. Le magasin est choisi par
 * `RATE_LIMIT_STORE` :
 *
 * - `postgres` — compteur commun à tous les process, obligatoire dès qu'il y en
 *   a plus d'un, et **imposé en production** (`src/instrumentation.ts`) ;
 * - `memory` — compteur par process, réservé au développement et aux tests.
 *   Avec N instances, la limite réelle serait N fois la limite annoncée.
 *
 * L'identifiant (`ip`, `userId`, `ip|email`) est une donnée potentiellement
 * personnelle : il entre dans la clé du compteur mais n'est **jamais**
 * journalisé.
 */
export type RateLimitDomain =
  | 'auth:login'
  | 'auth:register'
  | 'auth:reset'
  | 'import:upload'
  | 'ai:user'
  | 'api:general'
  | 'store-notifications';

interface RateLimitRule {
  /** Nombre de tentatives autorisées par fenêtre. */
  limit: number;
  /** Durée de la fenêtre, en millisecondes. */
  windowMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const RULES: Readonly<Record<RateLimitDomain, RateLimitRule>> = {
  'auth:login': { limit: 10, windowMs: 15 * MINUTE },
  'auth:register': { limit: 5, windowMs: HOUR },
  'auth:reset': { limit: 5, windowMs: HOUR },
  'import:upload': { limit: 20, windowMs: HOUR },
  'ai:user': { limit: 30, windowMs: HOUR },
  'api:general': { limit: 300, windowMs: MINUTE },
  'store-notifications': { limit: 600, windowMs: MINUTE },
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Magasin de compteurs. Injectable pour la même raison que le client des stores
 * ou le provider IA : le code de décision reste identique, seul le support
 * change.
 */
export interface RateLimitStore {
  /** Incrémente la fenêtre et renvoie le compteur **après** incrément. */
  increment(key: string, expiresAt: Date): Promise<number>;
}

/** Compteur par process : développement et tests uniquement. */
export function createMemoryRateLimitStore(): RateLimitStore & { clear: () => void } {
  const counters = new Map<string, { count: number; expiresAt: number }>();

  return {
    increment: (key, expiresAt) => {
      const now = Date.now();
      const existing = counters.get(key);

      // Purge opportuniste : la clé porte le début de fenêtre, une entrée
      // périmée n'est donc plus jamais relue.
      if (counters.size > 10_000) {
        for (const [candidate, counter] of counters) {
          if (counter.expiresAt <= now) {
            counters.delete(candidate);
          }
        }
      }

      if (existing === undefined) {
        counters.set(key, { count: 1, expiresAt: expiresAt.getTime() });

        return Promise.resolve(1);
      }

      existing.count += 1;

      return Promise.resolve(existing.count);
    },
    clear: () => {
      counters.clear();
    },
  };
}

const memoryStore = createMemoryRateLimitStore();

const postgresStore: RateLimitStore = {
  increment: (key, expiresAt) => rateLimitRepository.increment(key, expiresAt),
};

let override: RateLimitStore | null = null;

/** Substitue le magasin. Réservé aux tests. */
export function setRateLimitStoreForTests(store: RateLimitStore | null): void {
  override = store;
}

function activeStore(): RateLimitStore {
  if (override !== null) {
    return override;
  }

  return getServerEnv().RATE_LIMIT_STORE === 'postgres' ? postgresStore : memoryStore;
}

/**
 * Début de la fenêtre courante.
 *
 * Il entre dans la clé : deux fenêtres successives ne partagent donc jamais de
 * compteur, et il n'y a rien à remettre à zéro.
 */
function windowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

export function rateLimitKey(domain: RateLimitDomain, identifier: string, now: number): string {
  const rule = RULES[domain];

  return `${domain}:${identifier}:${String(windowStart(now, rule.windowMs))}`;
}

/**
 * Consomme une unité de quota.
 *
 * `identifier` est la clé métier du domaine : adresse IP, `ip|email` tenté,
 * `userId`… Il ne doit jamais être journalisé tel quel s'il contient une
 * donnée personnelle.
 *
 * En cas d'indisponibilité du magasin partagé, la requête est **autorisée** :
 * une base momentanément injoignable ne doit pas rendre l'API inutilisable,
 * et l'incident est journalisé sans identifiant. C'est un choix explicite —
 * disponibilité plutôt que fermeture — cohérent avec le fait que le rate
 * limiting protège d'un abus, pas d'un accès non autorisé (l'autorisation, elle,
 * échoue toujours fermée).
 */
export async function consumeRateLimit(
  domain: RateLimitDomain,
  identifier: string,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const rule = RULES[domain];
  const start = windowStart(now, rule.windowMs);
  const resetAt = start + rule.windowMs;
  const key = `${domain}:${identifier}:${String(start)}`;

  let count: number;

  try {
    count = await activeStore().increment(key, new Date(resetAt));
  } catch (error) {
    console.error(
      `Compteur de rate limiting indisponible (${
        error instanceof Error ? error.name : typeof error
      }) — requête autorisée.`,
    );

    return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: 0 };
  }

  if (count > rule.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  return { allowed: true, remaining: rule.limit - count, retryAfterSeconds: 0 };
}

/** Vide les compteurs en mémoire — réservé aux tests. */
export function resetRateLimits(): void {
  memoryStore.clear();
}

export function getRateLimitRule(domain: RateLimitDomain): RateLimitRule {
  return RULES[domain];
}
