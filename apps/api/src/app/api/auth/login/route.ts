import { loginSchema } from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { clientIpFromRequest, parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { deviceLabelFromRequest } from '@/server/auth/device-label';
import { authService } from '@/server/services/auth.service';

/**
 * POST /api/auth/login — `specs/auth-comptes-rgpd.md` §4.
 *
 * Rate limiting par IP **et** par e-mail tenté : limiter uniquement par IP
 * laisserait un attaquant distribué marteler un compte précis, limiter
 * uniquement par e-mail laisserait balayer de nombreux comptes depuis une même
 * origine.
 */
export const POST = route(async (request) => {
  const ip = clientIpFromRequest(request);
  await enforceRateLimit('auth:login', ip);

  const input = await parseJsonBody(request, loginSchema);
  await enforceRateLimit('auth:login', `${ip}|${input.email}`);

  const session = await authService.login(input, deviceLabelFromRequest(request));

  return jsonSuccess(session);
});
