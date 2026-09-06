import { requestPasswordResetSchema } from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { clientIpFromRequest, parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { authService } from '@/server/services/auth.service';

/**
 * POST /api/auth/request-password-reset — `specs/auth-comptes-rgpd.md` §5.
 *
 * Réponse toujours identique, que le compte existe ou non : aucune énumération
 * d'adresses possible.
 */
const GENERIC_MESSAGE =
  'Si un compte correspondant existe, un e-mail de réinitialisation a été envoyé.';

export const POST = route(async (request) => {
  const ip = clientIpFromRequest(request);
  await enforceRateLimit('auth:reset', ip);

  const input = await parseJsonBody(request, requestPasswordResetSchema);
  await enforceRateLimit('auth:reset', `${ip}|${input.email}`);

  await authService.requestPasswordReset(input.email);

  return jsonSuccess({ message: GENERIC_MESSAGE });
});
