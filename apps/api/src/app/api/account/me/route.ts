import { enforceRateLimit, route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { userService } from '@/server/services/user.service';

/**
 * GET /api/account/me — `specs/auth-comptes-rgpd.md` §7.
 * Renvoie le profil de l'utilisateur de la session, jamais celui d'un autre.
 */
export const GET = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const profile = await userService.getProfile(user.id);

  return jsonSuccess({ user: profile });
});
