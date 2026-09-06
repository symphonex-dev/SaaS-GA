import type { ComparisonOffer, Expense, UserSavingsGoal } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

/**
 * Lectures du tableau de bord.
 *
 * Toutes les requêtes utilisateur sont filtrées par `userId` (CLAUDE.md §5.3).
 * Aucun calcul n'a lieu ici : les lignes sont remontées telles quelles au
 * moteur financier.
 */
export const dashboardRepository = {
  async listExpenses(userId: string): Promise<Expense[]> {
    return prisma.expense.findMany({ where: { userId }, orderBy: { date: 'asc' } });
  },

  async listSavingsGoals(userId: string): Promise<UserSavingsGoal[]> {
    return prisma.userSavingsGoal.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  },

  /**
   * Offres de comparaison encore valides pour un pays.
   *
   * Une offre dont la date de prochaine vérification est dépassée n'est plus
   * considérée comme vérifiée : elle est exclue plutôt que présentée comme
   * fiable (CLAUDE.md §5.12).
   */
  async listVerifiedOffers(country: string, now: Date): Promise<ComparisonOffer[]> {
    return prisma.comparisonOffer.findMany({
      where: { country, nextCheckAt: { gte: now } },
      orderBy: { serviceName: 'asc' },
    });
  },
};
