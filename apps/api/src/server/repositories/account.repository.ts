import type {
  Expense,
  ExpenseImportBatch,
  RecurringDetection,
  Subscription,
  UserSavingsGoal,
} from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

/**
 * Lectures et suppressions transverses au compte (export RGPD §8,
 * suppression §9). Toutes les requêtes sont filtrées par `userId`
 * (CLAUDE.md §5.3) : aucune donnée d'un autre utilisateur n'est jamais lue ni
 * supprimée.
 */
export interface AccountData {
  expenses: Expense[];
  recurringDetections: RecurringDetection[];
  savingsGoals: UserSavingsGoal[];
  importBatches: ExpenseImportBatch[];
  subscription: Subscription | null;
}

export const accountRepository = {
  async collectForExport(userId: string): Promise<AccountData> {
    const [expenses, recurringDetections, savingsGoals, importBatches, subscription] =
      await Promise.all([
        prisma.expense.findMany({ where: { userId }, orderBy: { date: 'desc' } }),
        prisma.recurringDetection.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
        prisma.userSavingsGoal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
        prisma.expenseImportBatch.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
        prisma.subscription.findUnique({ where: { userId } }),
      ]);

    return { expenses, recurringDetections, savingsGoals, importBatches, subscription };
  },

  /**
   * Supprime définitivement toutes les données du compte, dans une transaction.
   *
   * Les suppressions sont explicites plutôt que déléguées aux cascades de la
   * base : l'ordre est ainsi vérifiable en test et l'intention reste lisible.
   * Le résultat est identique à la cascade décrite dans la spec §9.
   */
  async deleteAccount(userId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.recurringDetection.deleteMany({ where: { userId } });
      await tx.expense.deleteMany({ where: { userId } });
      await tx.expenseImportBatch.deleteMany({ where: { userId } });
      await tx.userSavingsGoal.deleteMany({ where: { userId } });
      await tx.subscription.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.aiQuota.deleteMany({ where: { userId } });
      await tx.authSession.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });
  },
};
