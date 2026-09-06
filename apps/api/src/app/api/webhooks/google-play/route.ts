import { ERROR_CODES } from '@subscription-manager/shared';
import { timingSafeEqual } from 'node:crypto';

import { AppError } from '@/lib/api/errors';
import { enforceRateLimit, route } from '@/lib/api/handler';
import { clientIpFromRequest } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { googlePlayEvent } from '@/lib/billing/transitions';
import { getServerEnv } from '@/lib/env/server';
import { billingService } from '@/server/services/billing.service';

/**
 * POST /api/webhooks/google-play — Real-Time Developer Notifications
 * (`specs/paiement-in-app.md` §5).
 *
 * Traitement exigé, dans l'ordre : authenticité → idempotence → mise à jour →
 * journalisation sans donnée sensible → réponse 2xx rapide.
 *
 * Authenticité : Google pousse ces notifications via Pub/Sub, avec un jeton de
 * vérification placé dans l'URL d'abonnement. Ce jeton est comparé en temps
 * constant. Il ne constitue pas à lui seul une preuve : sauf pour les
 * transitions pures de §6, l'état est **relu auprès de l'API Google Play**
 * avant toute écriture — une notification forgée ne peut donc accorder aucun
 * plan.
 */

/** Enveloppe Pub/Sub : la charge utile est encodée en base64 dans `message.data`. */
interface PubSubEnvelope {
  message?: { data?: unknown; messageId?: unknown; publishTime?: unknown };
}

interface DeveloperNotification {
  version?: unknown;
  packageName?: unknown;
  eventTimeMillis?: unknown;
  subscriptionNotification?: {
    notificationType?: unknown;
    purchaseToken?: unknown;
    subscriptionId?: unknown;
  };
}

function assertAuthentic(request: Request): void {
  const expected = getServerEnv().GOOGLE_PLAY_PUBSUB_VERIFICATION_TOKEN;
  const provided = new URL(request.url).searchParams.get('token') ?? '';

  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);

  // Jeton non configuré : aucune notification n'est acceptée. La sécurité
  // échoue toujours du côté fermé.
  if (
    expectedBytes.length === 0 ||
    expectedBytes.length !== providedBytes.length ||
    !timingSafeEqual(expectedBytes, providedBytes)
  ) {
    throw new AppError(ERROR_CODES.WEBHOOK_SIGNATURE_INVALID, 'Notification non authentifiée.');
  }
}

function decodeNotification(envelope: PubSubEnvelope): DeveloperNotification | null {
  const data = envelope.message?.data;

  if (typeof data !== 'string') {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as DeveloperNotification;
  } catch {
    return null;
  }
}

export const POST = route(async (request) => {
  await enforceRateLimit('store-notifications', clientIpFromRequest(request));
  assertAuthentic(request);

  let envelope: PubSubEnvelope;

  try {
    envelope = (await request.json()) as PubSubEnvelope;
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Enveloppe Pub/Sub invalide.');
  }

  const notification = decodeNotification(envelope);
  const messageId = envelope.message?.messageId;
  const subscriptionNotification = notification?.subscriptionNotification;
  const purchaseToken = subscriptionNotification?.purchaseToken;
  const notificationType = subscriptionNotification?.notificationType;

  if (
    typeof messageId !== 'string' ||
    typeof purchaseToken !== 'string' ||
    typeof notificationType !== 'number'
  ) {
    // Notification illisible : acquittée pour ne pas provoquer une boucle de
    // réémission côté Google, mais rien n'est écrit.
    return jsonSuccess({ received: true, processed: false });
  }

  const outcome = await billingService.handleNotification({
    // `messageId` est l'identifiant d'idempotence fourni par Pub/Sub.
    eventId: `google:${messageId}`,
    store: 'GOOGLE_PLAY',
    type: String(notificationType),
    event: googlePlayEvent(notificationType),
    reference: { purchaseToken, originalTransactionId: purchaseToken },
    now: new Date(),
  });

  // Journalisation sans donnée sensible : ni jeton d'achat, ni identifiant de
  // compte, ni contenu de la notification.
  console.info(
    `Notification Google Play : type=${String(notificationType)}, traitée=${String(
      outcome.processed,
    )}${outcome.reason === undefined ? '' : `, motif=${outcome.reason}`}`,
  );

  return jsonSuccess({ received: true, processed: outcome.processed });
});
