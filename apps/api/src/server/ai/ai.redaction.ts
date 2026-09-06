import type { AiContext } from './ai.context';

/**
 * Rédaction du contexte (`specs/comparateur-et-assistant-ia.md` B.5).
 *
 * Rien ne part vers un provider sans passer par ce module. Le principe est une
 * **liste blanche** : le JSON transmis est reconstruit champ par champ à partir
 * de `AiContext`, jamais sérialisé depuis un objet issu de la base. Un champ
 * ajouté par mégarde en amont ne peut donc pas fuiter — il n'est simplement
 * pas recopié.
 *
 * Ne doivent jamais sortir : hash de mot de passe, token de session, token de
 * réinitialisation, secrets, identifiants de transaction des stores, données
 * d'un autre utilisateur, informations administratives.
 */

/**
 * Noms de champs interdits, en minuscules sans séparateur.
 *
 * Sert de garde-fou de dernier recours (`assertContextIsRedacted`) : la liste
 * blanche ci-dessus est la vraie protection, ce filtre attrape une régression.
 */
export const FORBIDDEN_CONTEXT_KEY_FRAGMENTS: readonly string[] = [
  'password',
  'passwordhash',
  'token',
  'tokenhash',
  'secret',
  'apikey',
  'authorization',
  'bearer',
  'session',
  'storetransactionid',
  'storeoriginaltransactionid',
  'email',
  'userid',
  'actor',
  'admin',
];

/**
 * Motifs de valeurs sensibles : empreintes hexadécimales longues et jetons
 * base64url longs.
 *
 * Le second motif exige à la fois une majuscule et un chiffre, pour ne pas
 * confondre un jeton avec un long libellé de commerçant sans espace
 * (« SUPERMARCHECARREFOURCITYPARISCENTREVILLE ») : un faux positif ferait
 * échouer un appel légitime.
 */
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /^[0-9a-f]{32,}$/i,
  /^(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{40,}$/,
  /^Bearer\s+/i,
];

export class ForbiddenContextFieldError extends Error {
  /** Nom du champ fautif — jamais sa valeur, qui est précisément le risque. */
  readonly field: string;

  constructor(field: string) {
    super(`Champ interdit dans le contexte IA : ${field}.`);
    this.name = 'ForbiddenContextFieldError';
    this.field = field;
  }
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Vérifie récursivement qu'aucun nom de champ interdit et qu'aucune valeur
 * manifestement sensible ne figure dans l'objet transmis.
 *
 * Lève `ForbiddenContextFieldError` plutôt que de nettoyer en silence : une
 * fuite doit faire échouer l'appel, pas être rattrapée discrètement.
 */
export function assertContextIsRedacted(value: unknown, path = 'context'): void {
  if (typeof value === 'string') {
    if (SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new ForbiddenContextFieldError(path);
    }

    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertContextIsRedacted(entry, `${path}[${String(index)}]`);
    });

    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalized = normalizeKey(key);

    if (FORBIDDEN_CONTEXT_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
      throw new ForbiddenContextFieldError(`${path}.${key}`);
    }

    assertContextIsRedacted(entry, `${path}.${key}`);
  }
}

/**
 * Reconstruit le contexte transmissible, champ par champ.
 *
 * C'est la liste blanche : ajouter une donnée au prompt impose de la déclarer
 * ici **et** dans `AiContext`, donc de passer par une revue explicite.
 */
export function redactAiContext(context: AiContext): AiContext {
  return {
    locale: context.locale,
    currency: context.currency,
    month: context.month,
    monthlyTotal: context.monthlyTotal,
    previousMonthlyTotal: context.previousMonthlyTotal,
    topCategories: context.topCategories.map((entry) => ({
      category: entry.category,
      amount: entry.amount,
    })),
    newRecurringExpenses: context.newRecurringExpenses.map((entry) => ({
      merchant: entry.merchant,
      amount: entry.amount,
    })),
    priceIncreases: context.priceIncreases.map((entry) => ({
      merchant: entry.merchant,
      previousAmount: entry.previousAmount,
      currentAmount: entry.currentAmount,
    })),
    cancelledExpenses: context.cancelledExpenses.map((entry) => ({ merchant: entry.merchant })),
  };
}

/**
 * Contexte prêt à être envoyé : rédigé, vérifié, puis sérialisé.
 *
 * Seule cette fonction produit la chaîne transmise au provider — aucun appelant
 * ne sérialise un contexte lui-même.
 */
export function serializeAiContext(context: AiContext): string {
  const redacted = redactAiContext(context);

  assertContextIsRedacted(redacted);

  return JSON.stringify(redacted);
}
