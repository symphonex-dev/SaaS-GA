import type {
  DetectionConfidence,
  DetectionStatus,
  ExpenseCategory,
  ExpenseFrequency,
  ExpenseSource,
  ExpenseStatus,
  ImportSourceType,
  PaymentMethod,
} from '../constants/enums';
import type { Id, IsoDateTimeString, MoneyDto } from './common';

/**
 * Projection du modèle `Expense` (schéma §4).
 *
 * `merchantDisplay` est la valeur à afficher : `merchantOverride` s'il existe,
 * sinon `merchantNormalized`. Elle est résolue côté serveur pour que le mobile
 * n'ait aucune règle métier à appliquer.
 */
export interface ExpenseDto {
  id: Id;
  merchantRaw: string;
  merchantNormalized: string;
  merchantOverride: string | null;
  merchantDisplay: string;
  amount: MoneyDto;
  date: IsoDateTimeString;
  frequency: ExpenseFrequency;
  category: ExpenseCategory;
  paymentMethod: PaymentMethod | null;
  notes: string | null;
  status: ExpenseStatus;
  source: ExpenseSource;
  importBatchId: Id | null;
  createdAt: IsoDateTimeString;
}

/** Projection du modèle `ExpenseImportBatch` (schéma §5). */
export interface ExpenseImportBatchDto {
  id: Id;
  sourceType: ImportSourceType;
  filename: string | null;
  rowCount: number;
  importedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  createdAt: IsoDateTimeString;
  /** Non nul si le lot a été annulé : le rollback est définitif pour ce lot. */
  rolledBackAt: IsoDateTimeString | null;
}

/**
 * Projection du modèle `RecurringDetection` (schéma §6).
 * Produite exclusivement par le moteur déterministe (CLAUDE.md §5.5).
 */
export interface RecurringDetectionDto {
  id: Id;
  expenseId: Id;
  frequency: ExpenseFrequency;
  confidenceScore: DetectionConfidence;
  status: DetectionStatus;
  /** Intervalle médian observé entre deux occurrences, en jours. */
  intervalDays: number;
  /** Variance des montants observés, en unités mineures (chaîne, cf. `MoneyDto`). */
  amountVariance: MoneyDto;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

/**
 * Ligne de la page « Abonnements » (`specs/ui-composants-mobile.md` §6).
 *
 * Entièrement calculée par `apps/api` : coût annuel, prochaine échéance et
 * variation de montant arrivent prêts à afficher (CLAUDE.md §5.1).
 */
export interface RecurringSummaryDto {
  detectionId: Id;
  expenseId: Id;
  merchant: string;
  category: ExpenseCategory;
  amount: MoneyDto;
  frequency: ExpenseFrequency;
  /** `null` pour une série irrégulière : aucune annualisation fixe possible. */
  annualCost: MoneyDto | null;
  lastPaymentDate: string;
  /** Prévision, jamais une certitude ; `null` si aucune n'est défendable. */
  nextExpectedDate: string | null;
  confidence: DetectionConfidence;
  status: DetectionStatus;
  /** Statut de la dépense la plus récente de la série. */
  expenseStatus: ExpenseStatus;
  priceChange: {
    previousAmount: MoneyDto;
    currentAmount: MoneyDto;
    percentage: string;
  } | null;
}
