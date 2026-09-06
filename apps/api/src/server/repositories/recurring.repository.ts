import type {
  DetectionStatus,
  Expense,
  ExpenseFrequency,
  RecurringDetection,
} from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

/**
 * Accès aux `RecurringDetection` (`specs/schema-donnees.md` §6).
 *
 * Toute lecture et toute écriture est filtrée par `userId` : une détection
 * appartient à un seul utilisateur et n'est jamais consultable par un autre
 * (`specs/moteur-recurrence.md` §9).
 */
export type DetectionWithExpense = RecurringDetection & { expense: Expense };

export interface DetectionWriteData {
  expenseId: string;
  frequency: ExpenseFrequency;
  confidenceScore: 'HIGH' | 'MEDIUM' | 'LOW';
  status: DetectionStatus;
  intervalDays: number;
  /** Représentation décimale exacte, jamais un flottant. */
  amountVariance: string;
}

export const recurringRepository = {
  /**
   * Dépenses éligibles à l'analyse de récurrence.
   *
   * Les transactions `CANCELLED` (et `TO_REVIEW`, non validées) sont exclues
   * dès la requête : elles ne doivent pas alimenter une nouvelle détection
   * active (`specs/moteur-recurrence.md` §2).
   */
  async listActiveExpenses(userId: string): Promise<Expense[]> {
    return prisma.expense.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { date: 'asc' },
    });
  },

  async listForUser(userId: string): Promise<DetectionWithExpense[]> {
    return prisma.recurringDetection.findMany({
      where: { userId },
      include: { expense: true },
      orderBy: { createdAt: 'asc' },
    });
  },

  /** La dépense liée est incluse : elle porte la devise de la série. */
  async findForUser(id: string, userId: string): Promise<DetectionWithExpense | null> {
    return prisma.recurringDetection.findFirst({
      where: { id, userId },
      include: { expense: true },
    });
  },

  async create(userId: string, data: DetectionWriteData): Promise<RecurringDetection> {
    return prisma.recurringDetection.create({ data: { userId, ...data } });
  },

  async update(
    id: string,
    userId: string,
    data: Partial<DetectionWriteData> & { updatedAt?: Date },
  ): Promise<number> {
    const result = await prisma.recurringDetection.updateMany({ where: { id, userId }, data });

    return result.count;
  },

  /** Supprime les détections rattachées à des dépenses qui n'existent plus. */
  async deleteForUser(id: string, userId: string): Promise<void> {
    await prisma.recurringDetection.deleteMany({ where: { id, userId } });
  },
};
