import { route } from '@/lib/api/handler';
import { jsonSuccess } from '@/lib/api/response';
import { requireSession, revokeSession } from '@/server/auth/session';

/**
 * POST /api/auth/logout — `specs/auth-comptes-rgpd.md` §4.
 *
 * La révocation serveur (`revokedAt`) est ce qui rend la déconnexion réelle :
 * la suppression du token dans `expo-secure-store` côté client n'invaliderait
 * rien à elle seule.
 */
export const POST = route(async (request) => {
  const session = await requireSession(request);

  await revokeSession(session.sessionId);

  return jsonSuccess({ revoked: true });
});
