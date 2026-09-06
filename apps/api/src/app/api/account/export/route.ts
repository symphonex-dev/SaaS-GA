import { enforceRateLimit, route } from '@/lib/api/handler';
import { requireUser } from '@/server/auth/session';
import { userService } from '@/server/services/user.service';

/**
 * GET /api/account/export — `specs/auth-comptes-rgpd.md` §8.
 *
 * Export RGPD du seul compte authentifié, renvoyé en pièce jointe.
 *
 * La réponse n'utilise pas l'enveloppe `{ success, data }` : c'est un fichier
 * téléchargeable destiné à l'utilisateur, pas un DTO consommé par l'application
 * — la spec §8 en fixe la forme exacte.
 */
export const GET = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const data = await userService.exportData(user.id);

  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="user-data.json"',
      'Cache-Control': 'no-store',
    },
  });
});
