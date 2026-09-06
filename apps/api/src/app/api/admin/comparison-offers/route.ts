import {
  comparisonOfferInputSchema,
  comparisonOfferQuerySchema,
} from '@subscription-manager/shared';

import { enforceRateLimit, route } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { requireAdmin } from '@/server/admin/admin-access';
import { comparisonAdminService } from '@/server/services/comparison-admin.service';

/**
 * Administration des offres — `specs/comparateur-et-assistant-ia.md` A.8.
 *
 * `requireAdmin` exige une session valide **et** un compte figurant dans la
 * liste blanche serveur : un utilisateur standard authentifié reçoit
 * `ADMIN_FORBIDDEN`. Le rôle n'est jamais lu depuis le corps de la requête.
 */
export const GET = route(async (request) => {
  const actor = await requireAdmin(request);
  await enforceRateLimit('api:general', actor.userId);

  const url = new URL(request.url);
  const query = comparisonOfferQuerySchema.parse({
    ...(url.searchParams.get('country') === null
      ? {}
      : { country: url.searchParams.get('country') }),
    ...(url.searchParams.get('serviceName') === null
      ? {}
      : { serviceName: url.searchParams.get('serviceName') }),
  });

  return jsonSuccess(await comparisonAdminService.list(query));
});

/**
 * POST — création d'une offre vérifiée à la main.
 *
 * Le prix vient de la saisie de l'administrateur, jamais d'une IA ni d'une
 * collecte automatique (A.1 et checklist A.9 : « aucun prix inventé »).
 */
export const POST = route(async (request) => {
  const actor = await requireAdmin(request);
  await enforceRateLimit('api:general', actor.userId);

  const input = await parseJsonBody(request, comparisonOfferInputSchema);
  const offer = await comparisonAdminService.create(actor, input);

  return jsonSuccess({ offer }, { status: 201 });
});
