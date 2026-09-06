import { registerSchema } from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { clientIpFromRequest, parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { deviceLabelFromRequest } from '@/server/auth/device-label';
import { authService } from '@/server/services/auth.service';

/**
 * POST /api/auth/register — `specs/auth-comptes-rgpd.md` §2 et §7.
 *
 * Dernière étape de l'onboarding : la création de compte précède toute
 * fonctionnalité, y compris le premier import (CLAUDE.md §5.14).
 */
export const POST = route(async (request) => {
  await enforceRateLimit('auth:register', clientIpFromRequest(request));

  const input = await parseJsonBody(request, registerSchema);
  const session = await authService.register(input, deviceLabelFromRequest(request));

  return jsonSuccess(session, { status: 201 });
});
