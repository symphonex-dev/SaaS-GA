import { updatePreferencesSchema } from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { userService } from '@/server/services/user.service';

/**
 * PATCH /api/account/preferences — `specs/auth-comptes-rgpd.md` §6.
 *
 * Modification *ultérieure* des préférences depuis les Paramètres ; le choix
 * initial se fait à l'inscription. La mise à jour porte sur
 * `session.user.id` : un éventuel `userId` dans le corps est ignoré, le schéma
 * Zod ne le reconnaissant pas.
 */
export const PATCH = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const preferences = await parseJsonBody(request, updatePreferencesSchema);
  const updated = await userService.updatePreferences(user.id, preferences);

  return jsonSuccess({ user: updated });
});
