import {
  DEFAULT_COUNTRY,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  countrySchema,
  currencySchema,
  localeSchema,
  type AuthenticatedUser,
} from '@subscription-manager/shared';
import type { Subscription, User } from '@prisma/client';

import { bearerTokenFromRequest } from '@/lib/api/request';
import { AuthErrors } from '@/lib/api/errors';
import { getServerEnv } from '@/lib/env/server';
import { generateSessionToken, hashSessionToken } from '@/lib/security/tokens';
import { effectivePlan } from '@/server/entitlements/entitlements';
import { authSessionRepository } from '@/server/repositories/auth-session.repository';

/**
 * Cycle de vie de la session (`specs/auth-comptes-rgpd.md` §1 et §4).
 *
 * Session par token opaque, jamais par cookie : l'API n'est consommée que par
 * le client mobile natif. Le token brut n'existe qu'une fois, dans la réponse
 * de `register`/`login` ; seule son empreinte SHA-256 est stockée.
 *
 * Déviation assumée par rapport à la signature de la spec §1 :
 * `requireUser()` prend la `Request` en paramètre au lieu de lire un contexte
 * global (`next/headers`). Motif : la dépendance devient explicite et chaque
 * route reste testable sans simuler le contexte d'exécution de Next.js. Le
 * comportement décrit par la spec est inchangé.
 */

export interface SessionContext {
  user: AuthenticatedUser;
  sessionId: string;
}

export interface IssuedSession {
  /** Token brut : renvoyé une seule fois au client, jamais persisté. */
  token: string;
  expiresAt: Date;
}

function sessionTtlMs(): number {
  return getServerEnv().AUTH_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Projette une ligne `User` sur l'identité de session.
 *
 * `passwordHash` et `deletedAt` ne franchissent jamais cette frontière. Les
 * colonnes `language`/`country`/`currency` sont des `String` en base : elles
 * sont revalidées ici, avec repli sur les valeurs par défaut si la base
 * contenait une valeur hors référentiel.
 *
 * `tier` n'est **jamais** recopié depuis la colonne : il est dérivé de
 * l'abonnement par `effectivePlan()` (`specs/schema-donnees.md` §3 —
 * « `User.tier` est dérivé exclusivement de `Subscription.plan` »,
 * `specs/paiement-in-app.md` §7). La colonne reste une projection
 * synchronisée à l'écriture, utile aux index ; elle ne fait jamais autorité à
 * la lecture, ce qui la rend incapable d'accorder un accès périmé.
 */
export function toAuthenticatedUser(
  user: User,
  subscription: Subscription | null,
  now: Date = new Date(),
): AuthenticatedUser {
  const language = localeSchema.safeParse(user.language);
  const country = countrySchema.safeParse(user.country);
  const currency = currencySchema.safeParse(user.currency);

  return {
    id: user.id,
    email: user.email,
    tier: effectivePlan(subscription, now),
    language: language.success ? language.data : DEFAULT_LOCALE,
    country: country.success ? country.data : DEFAULT_COUNTRY,
    currency: currency.success ? currency.data : DEFAULT_CURRENCY,
  };
}

/** Crée une session et renvoie le token brut (unique occurrence en clair). */
export async function issueSession(
  userId: string,
  deviceLabel: string | null,
  now: Date = new Date(),
): Promise<IssuedSession> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + sessionTtlMs());

  await authSessionRepository.create({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
    deviceLabel,
  });

  return { token, expiresAt };
}

/**
 * Résout la session courante depuis l'en-tête `Authorization: Bearer <token>`.
 *
 * Renvoie `null` — sans jamais distinguer les cas côté client — si :
 * en-tête absent ou mal formé, empreinte inconnue, session révoquée, session
 * expirée, ou compte supprimé.
 */
export async function getCurrentSession(
  request: Request,
  now: Date = new Date(),
): Promise<SessionContext | null> {
  const token = bearerTokenFromRequest(request);

  if (token === null) {
    return null;
  }

  const session = await authSessionRepository.findByTokenHash(hashSessionToken(token));

  if (session === null || session.revokedAt !== null || session.expiresAt <= now) {
    return null;
  }

  if (session.user.deletedAt !== null) {
    return null;
  }

  // Fenêtre glissante : l'usage repousse l'expiration.
  await authSessionRepository.touch(session.id, now, new Date(now.getTime() + sessionTtlMs()));

  return {
    user: toAuthenticatedUser(session.user, session.user.subscription, now),
    sessionId: session.id,
  };
}

export async function getCurrentUser(request: Request): Promise<AuthenticatedUser | null> {
  const session = await getCurrentSession(request);
  return session === null ? null : session.user;
}

/** Variante stricte : lève `AUTH_UNAUTHORIZED` en l'absence de session valide. */
export async function requireSession(request: Request): Promise<SessionContext> {
  const session = await getCurrentSession(request);

  if (session === null) {
    throw AuthErrors.unauthorized();
  }

  return session;
}

export async function requireUser(request: Request): Promise<AuthenticatedUser> {
  const session = await requireSession(request);
  return session.user;
}

/** Révoque la session courante (déconnexion, §4). */
export async function revokeSession(sessionId: string, now: Date = new Date()): Promise<void> {
  await authSessionRepository.revoke(sessionId, now);
}
