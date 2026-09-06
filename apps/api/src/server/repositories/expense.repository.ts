import type { Expense, Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

/**
 * Accès aux `Expense` (`specs/schema-donnees.md` §4).
 *
 * Toute lecture et toute écriture est filtrée par `userId` : une dépense
 * appartient à un seul utilisateur, et une requête qui ne le précise pas
 * n'existe pas dans ce module (CLAUDE.md §5.3).
 *
 * Les lectures d'agrégation du tableau de bord vivent dans
 * `dashboard.repository.ts` ; celui-ci porte le CRUD unitaire, utilisé par la
 * correction manuelle (`specs/ui-composants-mobile.md` §10).
 */
export interface ExpenseWriteData {
  merchantRaw: string;
  merchantNormalized: string;
  merchantOverride: string | null;
  /** Représentation décimale exacte de `Decimal(19, 4)`, jamais un flottant. */
  amount: string;
  currency: string;
  date: Date;
  frequency: Expense['frequency'];
  category: Expense['category'];
  paymentMethod: Expense['paymentMethod'];
  notes: string | null;
  status: Expense['status'];
  source: Expense['source'];
  importBatchId: string | null;
}

export const expenseRepository = {
  /**
   * Dépense d'un utilisateur donné.
   *
   * Le filtre `userId` fait partie de la clause `where` : une dépense d'un
   * autre utilisateur est introuvable, pas « trouvée puis refusée ».
   */
  async findForUser(id: string, userId: string): Promise<Expense | null> {
    return prisma.expense.findFirst({ where: { id, userId } });
  },

  async create(userId: string, data: ExpenseWriteData): Promise<Expense> {
    return prisma.expense.create({ data: { userId, ...data } });
  },

  /**
   * Met à jour une dépense de l'utilisateur.
   *
   * `updateMany` plutôt qu'`update` : la clause `where` porte le `userId`, donc
   * une tentative sur la dépense d'autrui modifie zéro ligne au lieu de lever
   * une erreur qui révélerait l'existence de la ressource.
   */
  async update(
    id: string,
    userId: string,
    data: Prisma.ExpenseUpdateInput & { updatedAt?: Date },
  ): Promise<number> {
    const result = await prisma.expense.updateMany({ where: { id, userId }, data });

    return result.count;
  },

  async delete(id: string, userId: string): Promise<number> {
    const result = await prisma.expense.deleteMany({ where: { id, userId } });

    return result.count;
  },

  /** Détections rattachées à une dépense, supprimées avec elle. */
  async deleteDetectionsForExpense(expenseId: string, userId: string): Promise<void> {
    await prisma.recurringDetection.deleteMany({ where: { expenseId, userId } });
  },
};
