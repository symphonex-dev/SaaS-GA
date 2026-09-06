import { merchantComparisonKey, tokenize } from '@/lib/merchant/normalize';

/**
 * Regroupement des transactions par commerçant
 * (`specs/moteur-recurrence.md` §2).
 *
 * Le moteur analyse un groupe de transactions partageant le même commerçant.
 * La clé de regroupement s'appuie sur la normalisation d'import (§9 de
 * `specs/import-releves.md`), avec la correction manuelle de l'utilisateur
 * toujours prioritaire.
 *
 * Aucune correspondance approximative : deux libellés qui ne se réduisent pas
 * exactement à la même clé sont deux commerçants distincts, jamais regroupés.
 */
export interface MerchantIdentity {
  merchantNormalized: string;
  merchantOverride?: string | null;
}

/** Libellé retenu pour le regroupement : la correction manuelle prime (§2). */
export function effectiveMerchant(identity: MerchantIdentity): string {
  const override = identity.merchantOverride?.trim();

  return override !== undefined && override.length > 0 ? override : identity.merchantNormalized;
}

/**
 * Clé de regroupement stable et déterministe (casse, accents et ponctuation
 * neutralisés). Deux exécutions sur la même entrée donnent la même clé.
 */
export function recurringMerchantKey(identity: MerchantIdentity): string {
  return merchantComparisonKey(effectiveMerchant(identity));
}

/** Longueur minimale d'un libellé pour être considéré comme identifiant. */
const MINIMUM_MERCHANT_LENGTH = 2;

/**
 * Un commerçant est « stable » (critère de confiance §6) lorsque son libellé
 * identifie réellement un tiers : au moins un jeton alphabétique et une
 * longueur suffisante.
 *
 * Un libellé vide ou purement numérique (référence de terminal, identifiant
 * technique résiduel) ne permet pas d'affirmer que les occurrences proviennent
 * bien du même commerçant : le critère n'est alors pas accordé.
 */
export function isStableMerchant(merchant: string): boolean {
  const tokens = tokenize(merchant);

  if (tokens.length === 0) {
    return false;
  }

  const hasAlphabeticToken = tokens.some((token) => /[a-z]/.test(token));
  const key = tokens.join('');

  return hasAlphabeticToken && key.length >= MINIMUM_MERCHANT_LENGTH;
}
