import type { BillingCycle, OfferLimits } from '@subscription-manager/shared';

/**
 * Offres de référence du comparateur — France, euros.
 *
 * Chaque prix a été relevé le 16 septembre 2026 sur la page officielle
 * indiquée dans `directOfficialUrl`, affichée pour la France (ou la zone
 * euro pour iCloud+). Seuls les tarifs publics en vigueur sont repris :
 * pas de prix promotionnel, pas d'essai gratuit, pas d'offre soumise à
 * condition (étudiants, 18-24 ans).
 *
 * `serviceName` est le nom de commerçant produit par la normalisation des
 * relevés (`MERCHANT_ALIAS_RULES`) : c'est la condition d'une correspondance
 * exacte, donc d'une recommandation. Le nom de la formule est la première
 * entrée de `features` (`ACTIONS_MANUELLES.md` §7 bis).
 *
 * À revérifier au plus tard à `NEXT_CHECK_AT` : passé cette date, les offres
 * disparaissent du comparateur. Pour une mise à jour, corriger les prix,
 * repousser les deux dates, puis relancer le script.
 */
export const VERIFIED_AT = '2026-09-16T16:00:00.000Z';
export const NEXT_CHECK_AT = '2026-10-16T16:00:00.000Z';

export interface ReferenceOffer {
  serviceName: string;
  /** Prix TTC affiché, en euros, avec exactement deux décimales. */
  priceEur: string;
  billingCycle: BillingCycle;
  /** La première entrée est le nom de la formule. */
  features: string[];
  limits: OfferLimits;
  directOfficialUrl: string;
}

const NETFLIX = 'https://help.netflix.com/fr/node/24926';
const SPOTIFY = 'https://www.spotify.com/fr/premium/';
const DISNEY = 'https://www.disneyplus.com/fr-fr';
const DEEZER = 'https://www.deezer.com/fr/offers';
const YOUTUBE = 'https://www.youtube.com/premium';
const AMAZON = 'https://www.amazon.fr/amazonprime';
const GOOGLE_ONE = 'https://one.google.com/about/plans';
const ICLOUD = 'https://support.apple.com/fr-fr/108047';
const MICROSOFT =
  'https://www.microsoft.com/fr-fr/microsoft-365/buy/compare-all-microsoft-365-products';

export const REFERENCE_OFFERS: readonly ReferenceOffer[] = [
  // --- Netflix -------------------------------------------------------------
  {
    serviceName: 'Netflix',
    priceEur: '7.99',
    billingCycle: 'MONTHLY',
    features: ['Standard avec pub', 'Avec publicités', 'Full HD (1080p)', '2 écrans simultanés'],
    limits: { simultaneousStreams: 2, maxResolution: '1080p', ads: true },
    directOfficialUrl: NETFLIX,
  },
  {
    serviceName: 'Netflix',
    priceEur: '14.99',
    billingCycle: 'MONTHLY',
    features: ['Standard', 'Sans publicité', 'Full HD (1080p)', '2 écrans simultanés'],
    limits: { simultaneousStreams: 2, maxResolution: '1080p', ads: false },
    directOfficialUrl: NETFLIX,
  },
  {
    serviceName: 'Netflix',
    priceEur: '21.99',
    billingCycle: 'MONTHLY',
    features: ['Premium', 'Sans publicité', '4K Ultra HD + HDR', '4 écrans simultanés'],
    limits: { simultaneousStreams: 4, maxResolution: '4K', ads: false },
    directOfficialUrl: NETFLIX,
  },

  // --- Spotify -------------------------------------------------------------
  {
    serviceName: 'Spotify',
    priceEur: '12.14',
    billingCycle: 'MONTHLY',
    features: ['Premium Personnel', '1 compte', 'Sans publicité', 'Écoute hors connexion'],
    limits: { accounts: 1 },
    directOfficialUrl: SPOTIFY,
  },
  {
    serviceName: 'Spotify',
    priceEur: '17.20',
    billingCycle: 'MONTHLY',
    features: ['Premium Duo', '2 comptes', 'Même adresse', 'Sans publicité'],
    limits: { accounts: 2 },
    directOfficialUrl: SPOTIFY,
  },
  {
    serviceName: 'Spotify',
    priceEur: '21.24',
    billingCycle: 'MONTHLY',
    features: ['Premium Famille', "Jusqu'à 6 comptes", 'Même adresse', 'Contrôle parental'],
    limits: { accounts: 6 },
    directOfficialUrl: SPOTIFY,
  },

  // --- Disney+ -------------------------------------------------------------
  {
    serviceName: 'Disney+',
    priceEur: '6.99',
    billingCycle: 'MONTHLY',
    features: ['Standard avec pub', 'Avec publicités', 'Full HD (1080p)', '2 écrans simultanés'],
    limits: { simultaneousStreams: 2, maxResolution: '1080p', ads: true },
    directOfficialUrl: DISNEY,
  },
  {
    serviceName: 'Disney+',
    priceEur: '10.99',
    billingCycle: 'MONTHLY',
    features: ['Standard', 'Sans publicité', 'Full HD (1080p)', '2 écrans simultanés'],
    limits: { simultaneousStreams: 2, maxResolution: '1080p', ads: false },
    directOfficialUrl: DISNEY,
  },
  {
    serviceName: 'Disney+',
    priceEur: '15.99',
    billingCycle: 'MONTHLY',
    features: ['Premium', 'Sans publicité', '4K Ultra HD', '4 écrans simultanés'],
    limits: { simultaneousStreams: 4, maxResolution: '4K', ads: false },
    directOfficialUrl: DISNEY,
  },

  // --- Deezer --------------------------------------------------------------
  {
    serviceName: 'Deezer',
    priceEur: '11.99',
    billingCycle: 'MONTHLY',
    features: ['Premium', '1 compte'],
    limits: { accounts: 1 },
    directOfficialUrl: DEEZER,
  },
  {
    serviceName: 'Deezer',
    priceEur: '15.99',
    billingCycle: 'MONTHLY',
    features: ['Duo', '2 comptes'],
    limits: { accounts: 2 },
    directOfficialUrl: DEEZER,
  },
  {
    serviceName: 'Deezer',
    priceEur: '19.99',
    billingCycle: 'MONTHLY',
    features: ['Famille', '6 comptes'],
    limits: { accounts: 6 },
    directOfficialUrl: DEEZER,
  },

  // --- YouTube Premium -----------------------------------------------------
  {
    serviceName: 'YouTube Premium',
    priceEur: '7.99',
    billingCycle: 'MONTHLY',
    features: ['Premium Lite', 'La plupart des vidéos sans publicité', 'Lecture en arrière-plan'],
    limits: { members: 1, ads: 'partial' },
    directOfficialUrl: YOUTUBE,
  },
  {
    serviceName: 'YouTube Premium',
    priceEur: '12.99',
    billingCycle: 'MONTHLY',
    features: ['Particulier', 'YouTube et YouTube Music sans publicité', 'Hors connexion'],
    limits: { members: 1, ads: false },
    directOfficialUrl: YOUTUBE,
  },
  {
    serviceName: 'YouTube Premium',
    priceEur: '19.99',
    billingCycle: 'MONTHLY',
    features: ['Pour deux', '2 membres du même foyer', 'Sans publicité'],
    limits: { members: 2, ads: false },
    directOfficialUrl: YOUTUBE,
  },
  {
    serviceName: 'YouTube Premium',
    priceEur: '29.99',
    billingCycle: 'MONTHLY',
    features: ['Famille', "Jusqu'à 6 membres du même foyer", 'Sans publicité'],
    limits: { members: 6, ads: false },
    directOfficialUrl: YOUTUBE,
  },

  // --- Amazon Prime --------------------------------------------------------
  {
    serviceName: 'Amazon Prime',
    priceEur: '6.99',
    billingCycle: 'MONTHLY',
    features: ['Abonnement mensuel'],
    limits: {},
    directOfficialUrl: AMAZON,
  },
  {
    serviceName: 'Amazon Prime',
    priceEur: '69.90',
    billingCycle: 'YEARLY',
    features: ['Prime Annuel'],
    limits: {},
    directOfficialUrl: AMAZON,
  },

  // --- Google One ----------------------------------------------------------
  {
    serviceName: 'Google One',
    priceEur: '1.99',
    billingCycle: 'MONTHLY',
    features: ['Basic (100 Go)', '100 Go de stockage', 'Partage avec 5 personnes'],
    limits: { storageGb: 100 },
    directOfficialUrl: GOOGLE_ONE,
  },
  {
    serviceName: 'Google One',
    priceEur: '19.99',
    billingCycle: 'YEARLY',
    features: ['Basic (100 Go)', '100 Go de stockage', 'Partage avec 5 personnes'],
    limits: { storageGb: 100 },
    directOfficialUrl: GOOGLE_ONE,
  },
  {
    serviceName: 'Google One',
    priceEur: '2.99',
    billingCycle: 'MONTHLY',
    features: ['Standard (200 Go)', '200 Go de stockage', 'Partage avec 5 personnes'],
    limits: { storageGb: 200 },
    directOfficialUrl: GOOGLE_ONE,
  },
  {
    serviceName: 'Google One',
    priceEur: '29.99',
    billingCycle: 'YEARLY',
    features: ['Standard (200 Go)', '200 Go de stockage', 'Partage avec 5 personnes'],
    limits: { storageGb: 200 },
    directOfficialUrl: GOOGLE_ONE,
  },
  {
    serviceName: 'Google One',
    priceEur: '9.99',
    billingCycle: 'MONTHLY',
    features: ['Google AI Plus (2 To)', '2 To de stockage', 'Fonctionnalités Gemini étendues'],
    limits: { storageGb: 2000 },
    directOfficialUrl: GOOGLE_ONE,
  },
  {
    serviceName: 'Google One',
    priceEur: '99.99',
    billingCycle: 'YEARLY',
    features: ['Google AI Plus (2 To)', '2 To de stockage', 'Fonctionnalités Gemini étendues'],
    limits: { storageGb: 2000 },
    directOfficialUrl: GOOGLE_ONE,
  },

  // --- iCloud+ (tarifs de la zone euro) -------------------------------------
  {
    serviceName: 'iCloud',
    priceEur: '0.99',
    billingCycle: 'MONTHLY',
    features: ['iCloud+ 50 Go', '50 Go de stockage'],
    limits: { storageGb: 50 },
    directOfficialUrl: ICLOUD,
  },
  {
    serviceName: 'iCloud',
    priceEur: '2.99',
    billingCycle: 'MONTHLY',
    features: ['iCloud+ 200 Go', '200 Go de stockage'],
    limits: { storageGb: 200 },
    directOfficialUrl: ICLOUD,
  },
  {
    serviceName: 'iCloud',
    priceEur: '9.99',
    billingCycle: 'MONTHLY',
    features: ['iCloud+ 2 To', '2 To de stockage'],
    limits: { storageGb: 2000 },
    directOfficialUrl: ICLOUD,
  },
  {
    serviceName: 'iCloud',
    priceEur: '29.99',
    billingCycle: 'MONTHLY',
    features: ['iCloud+ 6 To', '6 To de stockage'],
    limits: { storageGb: 6000 },
    directOfficialUrl: ICLOUD,
  },
  {
    serviceName: 'iCloud',
    priceEur: '59.99',
    billingCycle: 'MONTHLY',
    features: ['iCloud+ 12 To', '12 To de stockage'],
    limits: { storageGb: 12000 },
    directOfficialUrl: ICLOUD,
  },

  // --- Microsoft 365 -------------------------------------------------------
  {
    serviceName: 'Microsoft 365',
    priceEur: '10.00',
    billingCycle: 'MONTHLY',
    features: ['Personnel', '1 personne'],
    limits: { users: 1 },
    directOfficialUrl: MICROSOFT,
  },
  {
    serviceName: 'Microsoft 365',
    priceEur: '99.00',
    billingCycle: 'YEARLY',
    features: ['Personnel', '1 personne'],
    limits: { users: 1 },
    directOfficialUrl: MICROSOFT,
  },
  {
    serviceName: 'Microsoft 365',
    priceEur: '13.00',
    billingCycle: 'MONTHLY',
    features: ['Famille', '1 à 6 personnes'],
    limits: { users: 6 },
    directOfficialUrl: MICROSOFT,
  },
  {
    serviceName: 'Microsoft 365',
    priceEur: '129.00',
    billingCycle: 'YEARLY',
    features: ['Famille', '1 à 6 personnes'],
    limits: { users: 6 },
    directOfficialUrl: MICROSOFT,
  },
  {
    serviceName: 'Microsoft 365',
    priceEur: '22.00',
    billingCycle: 'MONTHLY',
    features: ['Premium', '1 à 6 personnes'],
    limits: { users: 6 },
    directOfficialUrl: MICROSOFT,
  },
  {
    serviceName: 'Microsoft 365',
    priceEur: '219.00',
    billingCycle: 'YEARLY',
    features: ['Premium', '1 à 6 personnes'],
    limits: { users: 6 },
    directOfficialUrl: MICROSOFT,
  },
];
