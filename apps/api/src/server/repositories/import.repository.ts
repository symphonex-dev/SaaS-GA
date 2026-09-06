import type { Expense, ExpenseImportBatch, ImportSourceType, Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

/**
 * Accès aux lots d'import et aux dépenses qu'ils créent
 * (`specs/import-releves.md` §10).
 *
 * Toutes les requêtes sont filtrées par `userId` : un lot d'un autre
 * utilisateur est invisible, pas seulement interdit (CLAUDE.md §5.3).
 */
export interface ImportBatchCounts {
  rowCount: number;
  importedCount: number;
  rejectedCount: number;
  duplicateCount: number;
}

export interface ExpenseToCreate {
  merchantRaw: string;
  merchantNormalized: string;
  amount: string;
  currency: string;
  date: Date;
  category: Prisma.ExpenseCreateManyInput['category'];
  paymentMethod: Prisma.ExpenseCreateManyInput['paymentMethod'];
}

export const importRepository = {
  /**
   * Crée le lot et ses dépenses dans une seule transaction : soit l'import
   * entier est enregistré, soit rien ne l'est (§2, insertion transactionnelle).
   */
  async createBatchWithExpenses(
    userId: string,
    batch: { sourceType: ImportSourceType; filename: string | null } & ImportBatchCounts,
    expenses: readonly ExpenseToCreate[],
  ): Promise<ExpenseImportBatch> {
    return prisma.$transaction(async (tx) => {
      const created = await tx.expenseImportBatch.create({
        data: {
          userId,
          sourceType: batch.sourceType,
          filename: batch.filename,
          rowCount: batch.rowCount,
          importedCount: batch.importedCount,
          rejectedCount: batch.rejectedCount,
          duplicateCount: batch.duplicateCount,
        },
      });

      for (const expense of expenses) {
        await tx.expense.create({
          data: {
            userId,
            importBatchId: created.id,
            merchantRaw: expense.merchantRaw,
            merchantNormalized: expense.merchantNormalized,
            amount: expense.amount,
            currency: expense.currency,
            date: expense.date,
            category: expense.category,
            paymentMethod: expense.paymentMethod,
            source: 'IMPORT',
          },
        });
      }

      return created;
    });
  },

  async findBatchForUser(id: string, userId: string): Promise<ExpenseImportBatch | null> {
    return prisma.expenseImportBatch.findFirst({ where: { id, userId } });
  },

  async countExpensesInBatch(batchId: string, userId: string): Promise<number> {
    return prisma.expense.count({ where: { importBatchId: batchId, userId } });
  },

  async countBatchesForUser(
    userId: string,
    filter: { sourceType?: ImportSourceType; createdAfter?: Date } = {},
  ): Promise<number> {
    return prisma.expenseImportBatch.count({
      where: {
        userId,
        // Un lot annulé ne consomme pas de quota : l'utilisateur doit pouvoir
        // corriger une erreur d'import sans être pénalisé.
        rolledBackAt: null,
        ...(filter.sourceType === undefined ? {} : { sourceType: filter.sourceType }),
        ...(filter.createdAfter === undefined ? {} : { createdAt: { gte: filter.createdAfter } }),
      },
    });
  },

  /** Dépenses de l'utilisateur servant de référence à la détection de doublons. */
  async listExpensesForDuplicateCheck(
    userId: string,
    since: Date,
  ): Promise<Array<Pick<Expense, 'id' | 'amount' | 'currency' | 'date' | 'merchantNormalized'>>> {
    return prisma.expense.findMany({
      where: { userId, date: { gte: since } },
      select: { id: true, amount: true, currency: true, date: true, merchantNormalized: true },
    });
  },

  /**
   * Annule un lot (§10) : supprime **uniquement** les dépenses créées par ce
   * lot, jamais les transactions préexistantes ayant servi à la détection de
   * doublons, et marque le lot comme annulé.
   */
  async rollbackBatch(batchId: string, userId: string, now: Date): Promise<number> {
    return prisma.$transaction(async (tx) => {
      const deleted = await tx.expense.deleteMany({ where: { importBatchId: batchId, userId } });

      await tx.expenseImportBatch.updateMany({
        where: { id: batchId, userId, rolledBackAt: null },
        data: { rolledBackAt: now },
      });

      return deleted.count;
    });
  },
};
