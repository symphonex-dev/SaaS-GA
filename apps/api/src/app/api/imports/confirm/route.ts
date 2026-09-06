import { confirmImportSchema } from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { requireUser } from '@/server/auth/session';
import { importService } from '@/server/services/import.service';

/**
 * POST /api/imports/confirm — `specs/import-releves.md` §10.
 *
 * Le serveur ré-analyse intégralement l'aperçu conservé côté serveur avant
 * d'insérer quoi que ce soit : les lignes envoyées par le client ne sont jamais
 * une source de vérité (§2). Seules les lignes listées dans `acceptedRows` et
 * jugées insérables par le serveur créent une dépense.
 */
export const POST = route(async (request) => {
  const user = await requireUser(request);
  await enforceRateLimit('api:general', user.id);

  const input = await parseJsonBody(request, confirmImportSchema);
  const result = await importService.confirm(user, input);

  return jsonSuccess(result, { status: 201 });
});
