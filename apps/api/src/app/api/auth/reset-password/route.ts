import { resetPasswordSchema } from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { clientIpFromRequest, parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { authService } from '@/server/services/auth.service';

/**
 * POST /api/auth/reset-password — `specs/auth-comptes-rgpd.md` §5.
 *
 * Token à usage unique et à expiration courte. Le changement de mot de passe
 * révoque toutes les sessions existantes de l'utilisateur.
 */
export const POST = route(async (request) => {
  await enforceRateLimit('auth:reset', clientIpFromRequest(request));

  const input = await parseJsonBody(request, resetPasswordSchema);

  await authService.resetPassword(input);

  return jsonSuccess({ reset: true });
});
