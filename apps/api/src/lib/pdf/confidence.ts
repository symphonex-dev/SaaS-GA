import type { PdfLineConfidence } from '@subscription-manager/shared';

/**
 * Score de confiance d'une ligne PDF (`specs/import-releves.md` §5).
 *
 * Barème déterministe, sans apprentissage ni heuristique floue :
 *  - HIGH   : date + montant + libellé exploitable ;
 *  - MEDIUM : date + montant, mais libellé faible (trop court, purement
 *             numérique) — l'utilisateur devra vérifier ;
 *  - LOW    : une composante essentielle manque, ou la ligne ressemble à un
 *             solde. Une ligne LOW n'est jamais insérée sans correction
 *             explicite (`PDF_LOW_CONFIDENCE_LINE`).
 */
export interface ConfidenceInput {
  hasDate: boolean;
  hasAmount: boolean;
  description: string | null;
  isBalanceLine: boolean;
}

/** En deçà, un libellé ne permet pas d'identifier un commerçant. */
const MINIMUM_DESCRIPTION_LENGTH = 3;

export function computeLineConfidence(input: ConfidenceInput): PdfLineConfidence {
  if (!input.hasDate || !input.hasAmount || input.isBalanceLine) {
    return 'LOW';
  }

  const description = input.description ?? '';
  const hasLetters = /\p{L}/u.test(description);

  if (description.length < MINIMUM_DESCRIPTION_LENGTH || !hasLetters) {
    return 'MEDIUM';
  }

  return 'HIGH';
}
