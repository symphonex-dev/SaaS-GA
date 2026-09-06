import { route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';

/**
 * GET /api/auth/session — `specs/auth-comptes-rgpd.md` §7.
 *
 * Permet au client mobile de valider au démarrage le token conservé dans
 * `expo-secure-store`. Un token absent, expiré ou révoqué produit
 * `AUTH_UNAUTHORIZED` : le client redirige alors vers l'inscription/connexion
 * (aucun mode invité — CLAUDE.md §5.14).
 */
export const GET = route(async (request) => {
  const user = await requireUser(request);

  return jsonSuccess({ user });
});
