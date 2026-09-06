/**
 * Comparateur d'offres (`specs/comparateur-et-assistant-ia.md` partie A).
 *
 * La V1 n'est pas un comparateur mondial : une petite base d'offres vérifiées
 * à la main suffit (A.1). Aucune offre n'est jamais générée par un LLM, aucun
 * prix n'est jamais inventé (CLAUDE.md §5.12).
 */

/** Au-delà de cet âge, une offre n'est plus présentée comme « vérifiée » (A.6). */
export const COMPARISON_OFFER_MAX_AGE_DAYS = 30;

/** Millisecondes correspondantes, pour éviter de réécrire le calcul partout. */
export const COMPARISON_OFFER_MAX_AGE_MS = COMPARISON_OFFER_MAX_AGE_DAYS * 86_400_000;

/**
 * Fraîcheur d'une offre (A.6) :
 *  - `FRESH`   : vérifiée il y a moins de `COMPARISON_OFFER_MAX_AGE_DAYS` jours ;
 *  - `STALE`   : vérification trop ancienne — consultable, jamais recommandée ;
 *  - `EXPIRED` : date de prochaine vérification dépassée — exclue du matching (A.3).
 */
export const OFFER_FRESHNESS = ['FRESH', 'STALE', 'EXPIRED'] as const;
export type OfferFreshness = (typeof OFFER_FRESHNESS)[number];

/**
 * Nature du rapprochement (A.3).
 *
 * `EXACT` seul constitue une correspondance confirmée. `SUGGESTED` est une
 * piste à faire valider par l'utilisateur : elle n'entre dans aucun calcul
 * d'économie automatique et n'est jamais présentée comme certaine.
 */
export const OFFER_MATCH_KINDS = ['EXACT', 'SUGGESTED'] as const;
export type OfferMatchKind = (typeof OFFER_MATCH_KINDS)[number];

/** Actions d'administration auditées (A.8). */
export const OFFER_AUDIT_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'VERIFY'] as const;
export type OfferAuditAction = (typeof OFFER_AUDIT_ACTIONS)[number];
