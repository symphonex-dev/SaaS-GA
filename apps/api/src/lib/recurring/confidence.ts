import type { DetectionConfidence } from '@subscription-manager/shared';

/**
 * Grille de confiance (`specs/moteur-recurrence.md` §6).
 *
 * Cette grille est la **seule** définition du score : aucun autre fichier ne
 * doit attribuer ou pondérer des points. Elle est entièrement déterministe —
 * mêmes critères, même score, à chaque exécution.
 */
export const CONFIDENCE_POINTS = {
  /** Le libellé identifie réellement un tiers (§6, « commerçant stable »). */
  stableMerchant: 30,
  /** Une périodicité nommée a été retenue (hebdo, mensuel, trimestriel, annuel). */
  periodicInterval: 25,
  /** Au moins 5 occurrences observées. */
  manyOccurrences: 20,
  /** Faible variation de montant entre les occurrences. */
  lowAmountVariance: 15,
  /** Historique d'au moins 90 jours. */
  longHistory: 10,
} as const;

export const CONFIDENCE_THRESHOLDS = { high: 80, medium: 60 } as const;

/** Seuils d'attribution des critères, exprimés en unités observables. */
export const CONFIDENCE_CRITERIA = {
  manyOccurrencesFrom: 5,
  longHistoryFromDays: 90,
  /** Variation relative maximale (en %) pour parler de montant stable. */
  lowVarianceMaxPercent: 5,
} as const;

export interface ConfidenceInput {
  stableMerchant: boolean;
  periodicInterval: boolean;
  occurrences: number;
  lowAmountVariance: boolean;
  spanDays: number;
}

export interface ConfidenceResult {
  score: number;
  level: DetectionConfidence;
}

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  let score = 0;

  if (input.stableMerchant) {
    score += CONFIDENCE_POINTS.stableMerchant;
  }

  if (input.periodicInterval) {
    score += CONFIDENCE_POINTS.periodicInterval;
  }

  if (input.occurrences >= CONFIDENCE_CRITERIA.manyOccurrencesFrom) {
    score += CONFIDENCE_POINTS.manyOccurrences;
  }

  if (input.lowAmountVariance) {
    score += CONFIDENCE_POINTS.lowAmountVariance;
  }

  if (input.spanDays >= CONFIDENCE_CRITERIA.longHistoryFromDays) {
    score += CONFIDENCE_POINTS.longHistory;
  }

  return { score, level: toLevel(score) };
}

export function toLevel(score: number): DetectionConfidence {
  if (score >= CONFIDENCE_THRESHOLDS.high) {
    return 'HIGH';
  }

  return score >= CONFIDENCE_THRESHOLDS.medium ? 'MEDIUM' : 'LOW';
}
