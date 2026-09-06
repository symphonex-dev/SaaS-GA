import type { BillingEvent, SubscriptionStatus } from '@subscription-manager/shared';

/**
 * Traduction des événements des stores (`specs/paiement-in-app.md` §5 et §6).
 *
 * Module **pur** : aucune base, aucun réseau. Il ne fait que ramener deux
 * vocabulaires (entiers Google, chaînes + sous-types Apple) à un vocabulaire
 * unique, ce qui rend la règle §6 testable indépendamment du transport.
 */

/**
 * Types de notification Google Play (Real-Time Developer Notifications).
 *
 * Valeurs numériques définies par Google ; les six événements exigés par §5
 * sont couverts, plus ceux qui modifient réellement l'accès.
 */
export const GOOGLE_PLAY_NOTIFICATION_TYPES = {
  SUBSCRIPTION_RECOVERED: 1,
  SUBSCRIPTION_RENEWED: 2,
  SUBSCRIPTION_CANCELED: 3,
  SUBSCRIPTION_PURCHASED: 4,
  SUBSCRIPTION_ON_HOLD: 5,
  SUBSCRIPTION_IN_GRACE_PERIOD: 6,
  SUBSCRIPTION_RESTARTED: 7,
  SUBSCRIPTION_PRICE_CHANGE_CONFIRMED: 8,
  SUBSCRIPTION_DEFERRED: 9,
  SUBSCRIPTION_PAUSED: 10,
  SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED: 11,
  SUBSCRIPTION_REVOKED: 12,
  SUBSCRIPTION_EXPIRED: 13,
} as const;

const GOOGLE_PLAY_EVENTS: Readonly<Record<number, BillingEvent>> = {
  [GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_RECOVERED]: 'RESTARTED',
  [GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_RENEWED]: 'RENEWED',
  // Émis dès la désactivation du renouvellement automatique, bien avant la fin
  // de la période déjà payée : c'est une résiliation, pas une expiration (§6).
  [GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_CANCELED]: 'CANCELED',
  [GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_PURCHASED]: 'PURCHASED',
  [GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_ON_HOLD]: 'ON_HOLD',
  [GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_IN_GRACE_PERIOD]: 'GRACE_PERIOD',
  [GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_RESTARTED]: 'RESTARTED',
  [GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_PAUSED]: 'PAUSED',
  // Révocation (remboursement) : l'accès cesse immédiatement, contrairement à
  // une résiliation volontaire.
  [GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_REVOKED]: 'EXPIRED',
  [GOOGLE_PLAY_NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED]: 'EXPIRED',
};

/**
 * `null` pour un événement sans effet sur l'accès (changement de prix
 * confirmé, report, modification du calendrier de pause) : la notification est
 * alors acquittée et ignorée, jamais traitée à moitié.
 */
export function googlePlayEvent(notificationType: number): BillingEvent | null {
  return GOOGLE_PLAY_EVENTS[notificationType] ?? null;
}

/**
 * Types de notification Apple (App Store Server Notifications V2).
 *
 * `DID_CHANGE_RENEWAL_STATUS` dépend de son sous-type : c'est lui qui porte la
 * résiliation (`AUTO_RENEW_DISABLED`) ou sa reprise (`AUTO_RENEW_ENABLED`).
 */
export function appStoreEvent(
  notificationType: string,
  subtype: string | null,
): BillingEvent | null {
  switch (notificationType) {
    case 'SUBSCRIBED':
      return 'PURCHASED';
    case 'DID_RENEW':
      return 'RENEWED';
    case 'DID_CHANGE_RENEWAL_STATUS':
      return subtype === 'AUTO_RENEW_DISABLED' ? 'CANCELED' : 'RENEWAL_RESTORED';
    case 'DID_FAIL_TO_RENEW':
      // Sans période de grâce, l'échec conduit directement à la suspension.
      return subtype === 'GRACE_PERIOD' ? 'GRACE_PERIOD' : 'ON_HOLD';
    case 'DID_RENEW_FROM_BILLING_RETRY':
    case 'DID_RECOVER':
      return 'RESTARTED';
    case 'GRACE_PERIOD_EXPIRED':
    case 'EXPIRED':
    case 'REVOKE':
      return 'EXPIRED';
    default:
      return null;
  }
}

/**
 * Statut `Subscription` correspondant à un événement, quand celui-ci en change
 * un. `null` signifie « ne touche pas au statut ».
 *
 * `CANCELED` n'apparaît jamais ici : conformément à §6, une résiliation ne
 * modifie ni le plan ni le statut — elle ne pose que `cancelAtPeriodEnd`.
 */
export function statusForEvent(event: BillingEvent): SubscriptionStatus | null {
  switch (event) {
    case 'PURCHASED':
    case 'RENEWED':
    case 'RESTARTED':
      return 'ACTIVE';
    case 'GRACE_PERIOD':
      return 'GRACE_PERIOD';
    case 'ON_HOLD':
      return 'ON_HOLD';
    case 'PAUSED':
      return 'PAUSED';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return null;
  }
}

/** Un événement qui met fin à l'accès payant, donc ramène le plan à `FREE`. */
export function isExpiringEvent(event: BillingEvent): boolean {
  return event === 'EXPIRED';
}

/**
 * Un événement qui ne touche qu'au renouvellement automatique.
 *
 * C'est le cœur de la règle §6 : ces événements ne doivent modifier ni le plan,
 * ni le statut, ni la date de fin de période.
 */
export function isRenewalFlagEvent(event: BillingEvent): boolean {
  return event === 'CANCELED' || event === 'RENEWAL_RESTORED';
}
