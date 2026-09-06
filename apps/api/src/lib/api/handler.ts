import { AuthErrors } from './errors';
import { errorToResponse } from './response';
import { consumeRateLimit, type RateLimitDomain } from '@/lib/security/rate-limit';

/**
 * Enveloppe commune des route handlers.
 *
 * Aucune route ne laisse remonter une exception : toute erreur est convertie en
 * réponse au format standard (`specs/auth-comptes-rgpd.md` §7), sans jamais
 * exposer de détail interne.
 */

/**
 * Contexte transmis par Next.js aux routes dynamiques (`[id]`). Les paramètres
 * sont asynchrones depuis Next 15.
 */
export interface RouteContext<Params = Record<string, string>> {
  params: Promise<Params>;
}

export type RouteHandler<Params = Record<string, string>> = (
  request: Request,
  context: RouteContext<Params>,
) => Promise<Response>;

/**
 * Le contexte est optionnel à l'appel : les routes statiques n'en reçoivent
 * pas, et les tests peuvent invoquer un handler avec la seule `Request`.
 */
export type WrappedRouteHandler<Params = Record<string, string>> = (
  request: Request,
  context?: RouteContext<Params>,
) => Promise<Response>;

export function route<Params = Record<string, string>>(
  handler: RouteHandler<Params>,
): WrappedRouteHandler<Params> {
  return async (request: Request, context?: RouteContext<Params>): Promise<Response> => {
    try {
      return await handler(request, context ?? { params: Promise.resolve({} as Params) });
    } catch (error) {
      return errorToResponse(error);
    }
  };
}

/**
 * Consomme le quota du domaine et lève `RATE_LIMITED` si la limite est
 * atteinte (`specs/auth-comptes-rgpd.md` §10).
 *
 * Asynchrone depuis le passage à un compteur **partagé entre instances** : le
 * décompte est un aller-retour vers le magasin commun (CLAUDE.md §10.11).
 */
export async function enforceRateLimit(domain: RateLimitDomain, identifier: string): Promise<void> {
  const result = await consumeRateLimit(domain, identifier);

  if (!result.allowed) {
    throw AuthErrors.rateLimited(result.retryAfterSeconds);
  }
}
