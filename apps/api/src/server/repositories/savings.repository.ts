import type { Prisma, UserSavingsGoal } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

/**
 * Accès aux `UserSavingsGoal` (`specs/schema-donnees.md` §8).
 *
 * Toute requête est filtrée par `userId` : un objectif appartient à un seul
 * utilisateur (CLAUDE.md §5.3). La lecture d'agrégation du tableau de bord
 * reste dans `dashboard.repository.ts` ; celui-ci porte le CRUD unitaire.
 */
export interface SavingsGoalWriteData {
  /** Représentation décimale exacte de `Decimal(19, 4)`, jamais un flottant. */
  targetAmount: string;
  achievedAmount: string;
  currency: string;
  status: UserSavingsGoal['status'];
}

export const savingsRepository = {
  async findForUser(id: string, userId: string): Promise<UserSavingsGoal | null> {
    return prisma.userSavingsGoal.findFirst({ where: { id, userId } });
  },

  async countForUser(userId: string): Promise<number> {
    return prisma.userSavingsGoal.count({ where: { userId } });
  },

  async create(userId: string, data: SavingsGoalWriteData): Promise<UserSavingsGoal> {
    return prisma.userSavingsGoal.create({ data: { userId, ...data } });
  },

  /**
   * `updateMany` plutôt qu'`update` : la clause `where` porte le `userId`, donc
   * une tentative sur l'objectif d'autrui modifie zéro ligne au lieu de lever
   * une erreur qui révélerait son existence.
   */
  async update(
    id: string,
    userId: string,
    data: Prisma.UserSavingsGoalUpdateInput,
  ): Promise<number> {
    const result = await prisma.userSavingsGoal.updateMany({ where: { id, userId }, data });

    return result.count;
  },

  async delete(id: string, userId: string): Promise<number> {
    const result = await prisma.userSavingsGoal.deleteMany({ where: { id, userId } });

    return result.count;
  },
};
