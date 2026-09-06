import { ERROR_CODES } from '@subscription-manager/shared';

import { AppError } from '@/lib/api/errors';
import { enforceRateLimit, route } from '@/lib/api/handler';
import { clientIpFromRequest } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import { decodeJws, verifySignedPayload } from '@/lib/billing/jws';
import { appStoreEvent } from '@/lib/billing/transitions';
import { getServerEnv } from '@/lib/env/server';
import { billingService } from '@/server/services/billing.service';

/**
 * POST /api/webhooks/app-store — App Store Server Notifications V2
 * (`specs/paiement-in-app.md` §5).
 *
 * Authenticité : la charge est un JWS signé par Apple, vérifié contre la
 * chaîne de certificats `x5c` et le certificat racine Apple **configuré**
 * (`APP_STORE_ROOT_CA`). Sans racine de confiance configurée, aucune
 * notification n'est acceptée.
 */
interface SignedEnvelope {
  signedPayload?: unknown;
}

interface NotificationPayload {
  notificationType?: unknown;
  subtype?: unknown;
  notificationUUID?: unknown;
  data?: {
    bundleId?: unknown;
    signedTransactionInfo?: unknown;
  };
}

function readTransactionIds(payload: NotificationPayload): {
  transactionId?: string;
  originalTransactionId?: string;
} {
  const signedTransactionInfo = payload.data?.signedTransactionInfo;

  if (typeof signedTransactionInfo !== 'string') {
    return {};
  }

  // La transaction est elle-même signée par Apple et arrive à l'intérieur
  // d'une charge déjà vérifiée : la relire ne rouvre aucune brèche.
  const info = decodeJws(signedTransactionInfo)?.payload;
  const transactionId = info?.['transactionId'];
  const originalTransactionId = info?.['originalTransactionId'];

  return {
    ...(typeof transactionId === 'string' ? { transactionId } : {}),
    ...(typeof originalTransactionId === 'string' ? { originalTransactionId } : {}),
  };
}

export const POST = route(async (request) => {
  await enforceRateLimit('store-notifications', clientIpFromRequest(request));

  const env = getServerEnv();

  let envelope: SignedEnvelope;

  try {
    envelope = (await request.json()) as SignedEnvelope;
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Corps de notification invalide.');
  }

  if (typeof envelope.signedPayload !== 'string') {
    throw new AppError(ERROR_CODES.WEBHOOK_SIGNATURE_INVALID, 'Charge signée absente.');
  }

  const verification = verifySignedPayload(
    envelope.signedPayload,
    env.APP_STORE_ROOT_CA,
    new Date(),
  );

  if (!verification.valid || verification.payload === null) {
    throw new AppError(ERROR_CODES.WEBHOOK_SIGNATURE_INVALID, 'Signature Apple invalide.');
  }

  const payload = verification.payload as NotificationPayload;
  const notificationType = payload.notificationType;
  const notificationUuid = payload.notificationUUID;

  if (typeof notificationType !== 'string' || typeof notificationUuid !== 'string') {
    return jsonSuccess({ received: true, processed: false });
  }

  // Une notification destinée à une autre application n'est jamais appliquée.
  if (
    env.APP_STORE_BUNDLE_ID.length > 0 &&
    typeof payload.data?.bundleId === 'string' &&
    payload.data.bundleId !== env.APP_STORE_BUNDLE_ID
  ) {
    throw new AppError(ERROR_CODES.WEBHOOK_SIGNATURE_INVALID, 'Bundle inattendu.');
  }

  const subtype = typeof payload.subtype === 'string' ? payload.subtype : null;

  const outcome = await billingService.handleNotification({
    // `notificationUUID` est l'identifiant d'idempotence fourni par Apple.
    eventId: `apple:${notificationUuid}`,
    store: 'APP_STORE',
    type: subtype === null ? notificationType : `${notificationType}:${subtype}`,
    event: appStoreEvent(notificationType, subtype),
    reference: readTransactionIds(payload),
    now: new Date(),
  });

  // Journalisation sans donnée sensible : ni identifiant de transaction, ni
  // identifiant de compte, ni contenu de la charge signée.
  console.info(
    `Notification App Store : type=${notificationType}${
      subtype === null ? '' : `/${subtype}`
    }, traitée=${String(outcome.processed)}${
      outcome.reason === undefined ? '' : `, motif=${outcome.reason}`
    }`,
  );

  return jsonSuccess({ received: true, processed: outcome.processed });
});
