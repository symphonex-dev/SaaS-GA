import { ERROR_CODES } from '@subscription-manager/shared';
import type { output, ZodTypeAny } from 'zod';

import { AppError } from './errors';

/**
 * Validation d'entrée (`specs/auth-comptes-rgpd.md` §1 et §10) : toute donnée
 * venant du client est hostile tant qu'elle n'a pas traversé un schéma Zod.
 */
export async function parseJsonBody<Schema extends ZodTypeAny>(
  request: Request,
  schema: Schema,
): Promise<output<Schema>> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Corps de requête JSON invalide.');
  }

  // `parse` lève une ZodError, convertie en VALIDATION_ERROR par le wrapper.
  // Le type de retour est celui produit *après* application des valeurs par
  // défaut du schéma, jamais celui du payload brut.
  return schema.parse(raw) as output<Schema>;
}

/**
 * Adresse cliente utilisée comme clé de rate limiting.
 *
 * Derrière un proxy de confiance (plateforme de déploiement), l'adresse réelle
 * est le premier élément de `x-forwarded-for`. En l'absence d'en-tête, une clé
 * constante est renvoyée : le rate limiting reste alors global plutôt que
 * silencieusement désactivé.
 */
export function clientIpFromRequest(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');

  if (forwardedFor !== null && forwardedFor.length > 0) {
    const firstHop = forwardedFor.split(',')[0]?.trim();

    if (firstHop !== undefined && firstHop.length > 0) {
      return firstHop;
    }
  }

  const realIp = request.headers.get('x-real-ip');

  if (realIp !== null && realIp.length > 0) {
    return realIp;
  }

  return 'unknown';
}

/**
 * Extrait le token opaque de l'en-tête `Authorization: Bearer <token>` (§4).
 * Renvoie `null` si l'en-tête est absent ou mal formé — jamais d'exception,
 * pour que `getCurrentUser()` puisse rester silencieux.
 */
export function bearerTokenFromRequest(request: Request): string | null {
  const header = request.headers.get('authorization');

  if (header === null) {
    return null;
  }

  const [scheme, token] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token.length === 0) {
    return null;
  }

  return token;
}
