import { ERROR_CODES } from '@subscription-manager/shared';
import { timingSafeEqual } from 'node:crypto';

import { AppError } from '@/lib/api/errors';
import { enforceRateLimit, route } from '@/lib/api/handler';
import { bearerTokenFromRequest, clientIpFromRequest } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { getServerEnv } from '@/lib/env/server';
import { billingService } from '@/server/services/billing.service';

/**
 * POST /api/billing/expire-overdue — job de secours de
 * `specs/paiement-in-app.md` §6.
 *
 * Repasse à `FREE` les abonnements dont `currentPeriodEnd` est dépassée sans
 * qu'aucune notification d'expiration ne soit arrivée. La spec prévoit « un job
 * planifié » ; l'application n'embarquant pas d'ordonnanceur, il est exposé ici
 * pour être déclenché par le planificateur de la plateforme d'hébergement.
 *
 * Protégé par un secret d'exploitation transmis en `Authorization: Bearer`,
 * comparé en temps constant. Secret non configuré = route injoignable.
 *
 * Ce job est un filet : `effectivePlan()` applique déjà la même règle à la
 * lecture, si bien qu'un retard d'exécution n'accorde jamais d'accès indu.
 */
function assertOperator(request: Request): void {
  const expected = Buffer.from(getServerEnv().BILLING_CRON_SECRET);
  const provided = Buffer.from(bearerTokenFromRequest(request) ?? '');

  if (
    expected.length === 0 ||
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    throw new AppError(ERROR_CODES.AUTH_UNAUTHORIZED, 'Authentification requise.');
  }
}

export const POST = route(async (request) => {
  await enforceRateLimit('api:general', clientIpFromRequest(request));
  assertOperator(request);

  return jsonSuccess(await billingService.expireOverdueSubscriptions());
});
