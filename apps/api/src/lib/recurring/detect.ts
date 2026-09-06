import {
  isSupportedCurrency,
  type DetectionConfidence,
  type ExpenseFrequency,
} from '@subscription-manager/shared';

import { minorUnitsToDecimalString } from '@/lib/finance/money';

import {
  computeAmountStatistics,
  detectPriceChange,
  parseAmounts,
  relativeVarianceAtMost,
  type PriceChange,
} from './amount';
import { CONFIDENCE_CRITERIA, computeConfidence } from './confidence';
import { classifyFrequency, MINIMUM_OCCURRENCES } from './frequency';
import { computeIntervals, sortDates, spanDays } from './interval';
import { isStableMerchant } from './normalize';

/**
 * Moteur de détection des récurrences (`specs/moteur-recurrence.md` §7).
 *
 * `detectRecurrence` est une **fonction pure** : aucun accès réseau, aucune
 * requête base, aucun appel à `Date.now()` ni `Math.random()`, aucune IA
 * (CLAUDE.md §5.5). Même entrée ⇒ même sortie, indéfiniment.
 *
 * Emplacement : la spec §1 énumère les modules de calcul (`interval`,
 * `amount`, `frequency`, `confidence`, `normalize`) sans désigner de fichier
 * pour la fonction d'assemblage. Elle vit ici plutôt que dans le service, qui
 * lui parle à la base et ne peut donc pas rester pur.
 */
export interface RecurringTransactionInput {
  id: string;
  /** Date calendaire ISO (`2026-01-05`). */
  date: string;
  /** Montant décimal exact, toujours positif. */
  amount: string;
}

export interface RecurringDetectionInput {
  merchantNormalized: string;
  currency: string;
  transactions: RecurringTransactionInput[];
}

export interface RecurringDetectionResult {
  isRecurring: boolean;
  frequency: ExpenseFrequency | null;
  confidence: DetectionConfidence | null;
  confidenceScore: number;
  intervalDays: number | null;
  /** `max - min` des montants observés, en décimal exact. */
  amountVariance: string;
  occurrences: number;
  priceChange: PriceChange | null;
}

function emptyResult(occurrences: number): RecurringDetectionResult {
  return {
    isRecurring: false,
    frequency: null,
    confidence: null,
    confidenceScore: 0,
    intervalDays: null,
    amountVariance: '0.00',
    occurrences,
    priceChange: null,
  };
}

export function detectRecurrence(input: RecurringDetectionInput): RecurringDetectionResult {
  const occurrences = input.transactions.length;

  if (!isSupportedCurrency(input.currency)) {
    // Devise hors référentiel : aucune comparaison de montants n'a de sens.
    return emptyResult(occurrences);
  }

  const currency = input.currency;

  // Tri chronologique systématique : l'ordre d'arrivée des transactions ne doit
  // jamais influer sur le résultat.
  const sorted = [...input.transactions].sort((left, right) =>
    left.date < right.date ? -1 : left.date > right.date ? 1 : left.id < right.id ? -1 : 1,
  );

  const dates = sortDates(sorted.map((transaction) => transaction.date));
  const amounts = parseAmounts(
    sorted.map((transaction) => transaction.amount),
    currency,
  );

  if (amounts === null) {
    return emptyResult(occurrences);
  }

  const statistics = computeAmountStatistics(amounts);

  if (statistics === null) {
    return emptyResult(occurrences);
  }

  const variance = minorUnitsToDecimalString(statistics.variance, currency);

  const priceChange = detectPriceChange(
    sorted.map((transaction, index) => ({
      date: transaction.date,
      amountMinorUnits: amounts[index] ?? 0n,
    })),
    currency,
  );

  // Une seule transaction n'est jamais récurrente ; deux ne suffisent pas (§3).
  if (occurrences < MINIMUM_OCCURRENCES) {
    return { ...emptyResult(occurrences), amountVariance: variance, priceChange };
  }

  const intervals = computeIntervals(dates);
  const history = spanDays(dates);
  const classification = classifyFrequency(intervals, history, occurrences);

  if (classification.frequency === null) {
    return {
      ...emptyResult(occurrences),
      amountVariance: variance,
      intervalDays: classification.intervalDays,
      priceChange,
    };
  }

  const confidence = computeConfidence({
    stableMerchant: isStableMerchant(input.merchantNormalized),
    periodicInterval: classification.periodic,
    occurrences,
    lowAmountVariance: relativeVarianceAtMost(
      statistics,
      CONFIDENCE_CRITERIA.lowVarianceMaxPercent,
    ),
    spanDays: history,
  });

  return {
    isRecurring: true,
    frequency: classification.frequency,
    confidence: confidence.level,
    confidenceScore: confidence.score,
    intervalDays: classification.intervalDays,
    amountVariance: variance,
    occurrences,
    priceChange,
  };
}
