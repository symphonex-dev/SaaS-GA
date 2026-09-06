/**
 * Normalisation des libellés de commerçant (`specs/import-releves.md` §9).
 *
 * Pipeline entièrement déterministe et hors ligne : aucune dépendance réseau,
 * aucune IA. Deux exécutions sur la même entrée donnent le même résultat, ce
 * qui est indispensable au moteur de récurrence (CLAUDE.md §5.5).
 *
 * `merchantRaw` n'est jamais modifié : la normalisation produit une valeur
 * supplémentaire, elle ne remplace pas l'original.
 */

export interface MerchantNormalizationResult {
  raw: string;
  normalized: string;
  tokens: string[];
}

export interface MerchantAliasRule {
  pattern: RegExp;
  normalized: string;
}

/**
 * Alias déterministes : appliqués sur le libellé nettoyé et minusculisé, avant
 * la capitalisation d'affichage. Liste volontairement courte et explicite —
 * jamais de correspondance approximative.
 */
export const MERCHANT_ALIAS_RULES: MerchantAliasRule[] = [
  { pattern: /^netflix(?:\.com)?(?:\s+.*)?$/i, normalized: 'Netflix' },
  { pattern: /^spotify(?:\s+ab)?(?:\s+.*)?$/i, normalized: 'Spotify' },
  { pattern: /^(?:disney\s*\+|disneyplus)(?:\s+.*)?$/i, normalized: 'Disney+' },
  { pattern: /^amazon\s+prime(?:\s+.*)?$/i, normalized: 'Amazon Prime' },
  { pattern: /^(?:google\s+)?youtube\s*premium(?:\s+.*)?$/i, normalized: 'YouTube Premium' },
  { pattern: /^google\s+one(?:\s+.*)?$/i, normalized: 'Google One' },
  { pattern: /^(?:apple\.com\/bill|apple\s+services)(?:\s+.*)?$/i, normalized: 'Apple' },
  { pattern: /^icloud(?:\+)?(?:\s+.*)?$/i, normalized: 'iCloud' },
  { pattern: /^microsoft\s*365(?:\s+.*)?$/i, normalized: 'Microsoft 365' },
  { pattern: /^deezer(?:\s+.*)?$/i, normalized: 'Deezer' },
  { pattern: /^canal\s*\+(?:\s+.*)?$/i, normalized: 'Canal+' },
  { pattern: /^orange(?:\s+(?:france|telecom|sa))?(?:\s+.*)?$/i, normalized: 'Orange' },
  { pattern: /^sfr(?:\s+.*)?$/i, normalized: 'SFR' },
  { pattern: /^free\s+mobile(?:\s+.*)?$/i, normalized: 'Free Mobile' },
  { pattern: /^bouygues(?:\s+telecom)?(?:\s+.*)?$/i, normalized: 'Bouygues Telecom' },
];

/**
 * Préfixes et mots-outils des libellés bancaires, retirés en tête de chaîne.
 * Retirés uniquement en position initiale : « carte » au milieu d'un nom
 * d'enseigne doit être conservé.
 */
const LEADING_NOISE_WORDS = [
  'carte',
  'cb',
  'paiement',
  'prelevement',
  'prlv',
  'prelvt',
  'virement',
  'vir',
  'achat',
  'facture',
  'card payment to',
  'direct debit',
  'payment to',
  'pos',
  'sepa',
];

/** Domaines fréquemment accolés au nom du commerçant. */
const KNOWN_DOMAIN_SUFFIXES = [
  '.com',
  '.net',
  '.fr',
  '.co.uk',
  '.io',
  '.eu',
  '.es',
  '.de',
  '.ca',
  '.org',
];

/**
 * Suffixes géographiques observés sur les relevés (ville ou pays du terminal).
 * Retirés uniquement en fin de libellé.
 */
const KNOWN_GEOGRAPHIC_SUFFIXES = [
  'amsterdam',
  'stockholm',
  'dublin',
  'london',
  'luxembourg',
  'paris',
  'madrid',
  'berlin',
  'san francisco',
  'seattle',
  'cupertino',
  'ie',
  'nl',
  'lu',
  'gb',
  'us',
  'fr',
];

/** Formes juridiques accolées au nom, sans valeur distinctive. */
const LEGAL_FORM_SUFFIXES = ['sas', 'sarl', 'sa', 'ab', 'bv', 'gmbh', 'ltd', 'llc', 'inc', 'plc'];

/**
 * Identifiants de transaction : longues séquences alphanumériques, numéros de
 * carte masqués, dates et références accolées au libellé.
 *
 * Un nombre court et significatif (« 7-ELEVEN », « Microsoft 365 ») n'est
 * jamais supprimé : seuls les blocs manifestement techniques le sont.
 */
const TRANSACTION_ID_PATTERNS: RegExp[] = [
  /\b\d{2}[/-]\d{2}(?:[/-]\d{2,4})?\b/g, // 12/03, 12-03-2026
  /\bx{2,}\d{2,}\b/gi, // xxxx1234 (carte masquée)
  /\*{2,}\d{2,}\b/g, // ****1234
  /\b(?:ref|num|auth|trx|txn)[.:]?\s*[a-z0-9-]{4,}\b/gi,
  /\b[a-z]*\d[a-z0-9]{7,}\b/gi, // identifiants alphanumériques longs
  /\b\d{8,}\b/g, // longues suites de chiffres
];

/** Caractères de contrôle Unicode (catégorie Cc) : tabulations, retours, NUL… */
const CONTROL_CHARACTERS = /\p{Cc}/gu;

function stripDiacriticsForTokens(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function removeLeadingNoise(value: string): string {
  let result = value;
  let changed = true;

  while (changed) {
    changed = false;

    for (const word of LEADING_NOISE_WORDS) {
      const prefix = `${word} `;

      if (result.startsWith(prefix)) {
        result = result.slice(prefix.length).trim();
        changed = true;
      }
    }
  }

  return result;
}

function removeTrailingWords(value: string, words: readonly string[]): string {
  let result = value;
  let changed = true;

  while (changed) {
    changed = false;

    for (const word of words) {
      const suffix = ` ${word}`;

      if (result.endsWith(suffix)) {
        result = result.slice(0, -suffix.length).trim();
        changed = true;
      }
    }
  }

  return result;
}

function removeKnownDomains(value: string): string {
  let result = value;

  for (const domain of KNOWN_DOMAIN_SUFFIXES) {
    // Uniquement collé à un mot (netflix.com), jamais au milieu d'un nom.
    const escaped = domain.replaceAll('.', '\\.');
    result = result.replaceAll(new RegExp(`(\\S)${escaped}(?=\\s|$)`, 'gi'), '$1');
  }

  return result;
}

/** Capitalisation d'affichage : « netflix » → « Netflix », « 7-eleven » → « 7-Eleven ». */
function toDisplayCase(value: string): string {
  return value
    .split(' ')
    .map((word) =>
      word
        .split('-')
        .map((part) => (part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
        .join('-'),
    )
    .join(' ');
}

export function normalizeMerchant(merchantRaw: string): MerchantNormalizationResult {
  // 1. trim + normalisation Unicode + suppression des caractères de contrôle.
  const controlFree = merchantRaw.normalize('NFC').replace(CONTROL_CHARACTERS, ' ').trim();

  // 2. minuscules et espaces multiples réduits. Les séparateurs (`/`, `-`) sont
  //    volontairement conservés à ce stade : ils font partie des motifs
  //    d'identifiants transactionnels retirés juste après (« 12/03 »).
  let working = controlFree.toLowerCase().replace(/\s+/g, ' ').trim();

  // 3. suppression des identifiants transactionnels évidents.
  for (const pattern of TRANSACTION_ID_PATTERNS) {
    working = working.replaceAll(pattern, ' ');
  }

  // 4. normalisation des séparateurs restants.
  working = working
    .replace(/[_|/\\,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 5. bruit bancaire en tête, domaines connus, suffixes géographiques et
  //    formes juridiques en fin de libellé.
  working = removeLeadingNoise(working);
  working = removeKnownDomains(working).replace(/\s+/g, ' ').trim();
  working = removeTrailingWords(working, KNOWN_GEOGRAPHIC_SUFFIXES);
  working = removeTrailingWords(working, LEGAL_FORM_SUFFIXES);
  working = working
    .replace(/\s{2,}/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim();

  // 6. alias déterministes, appliqués sur le libellé nettoyé ET sur le libellé
  //    d'origine minusculisé (un alias doit fonctionner même si le nettoyage a
  //    retiré la partie qui portait le motif).
  const lowercasedRaw = controlFree.toLowerCase().replace(/\s+/g, ' ').trim();

  for (const rule of MERCHANT_ALIAS_RULES) {
    if (rule.pattern.test(working) || rule.pattern.test(lowercasedRaw)) {
      return {
        raw: merchantRaw,
        normalized: rule.normalized,
        tokens: tokenize(rule.normalized),
      };
    }
  }

  // 7. capitalisation d'affichage. Un libellé devenu vide retombe sur la valeur
  //    d'origine nettoyée : mieux vaut un libellé imparfait qu'un libellé vide.
  const normalized = working.length === 0 ? controlFree : toDisplayCase(working);

  return { raw: merchantRaw, normalized, tokens: tokenize(normalized) };
}

/** Jetons comparables : minuscules, sans accents, sans ponctuation. */
export function tokenize(value: string): string[] {
  return stripDiacriticsForTokens(value)
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((token) => token.length > 0);
}

/**
 * Clé de comparaison de deux commerçants (détection de doublons, §8).
 * Tolérance de format uniquement : casse, accents, ponctuation, espaces.
 * Aucune tolérance sémantique.
 */
export function merchantComparisonKey(normalized: string): string {
  return tokenize(normalized).join(' ');
}

/**
 * Nom effectivement affiché (§9) : la correction manuelle de l'utilisateur est
 * toujours prioritaire sur la normalisation automatique.
 */
export function getEffectiveMerchantName(expense: {
  merchantNormalized: string;
  merchantOverride?: string | null;
}): string {
  const override = expense.merchantOverride?.trim();

  return override !== undefined && override.length > 0 ? override : expense.merchantNormalized;
}
