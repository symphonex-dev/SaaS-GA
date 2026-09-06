import type { PasswordResetToken } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

/**
 * Accès aux `PasswordResetToken` (`specs/auth-comptes-rgpd.md` §5).
 * Usage unique, expiration courte, seul le hash est stocké.
 */
export const passwordResetTokenRepository = {
  async create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<PasswordResetToken> {
    return prisma.passwordResetToken.create({ data });
  },

  async findByTokenHash(tokenHash: string): Promise<PasswordResetToken | null> {
    return prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  },

  /**
   * Marque le token comme consommé. Le filtre `usedAt: null` rend l'opération
   * atomique : deux requêtes concurrentes ne peuvent pas consommer le même
   * token (la seconde met à jour 0 ligne).
   */
  async markUsed(id: string, usedAt: Date): Promise<boolean> {
    const result = await prisma.passwordResetToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt },
    });

    return result.count === 1;
  },

  /** Invalide les demandes en attente d'un utilisateur (nouvelle demande, reset réussi). */
  async invalidatePendingForUser(userId: string, usedAt: Date): Promise<number> {
    const result = await prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt },
    });

    return result.count;
  },
};
