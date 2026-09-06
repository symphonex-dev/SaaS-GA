import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

/**
 * Aperçus d'import persistés (`specs/import-releves.md` §2 et §3).
 *
 * Isolation : **toute** lecture et toute écriture portent le `userId` de la
 * session. Un aperçu appartenant à un autre compte est traité exactement comme
 * un aperçu inexistant — jamais « trouvé puis refusé » (CLAUDE.md §5.3).
 */
export interface StoredPreviewRow {
  id: string;
  userId: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

export const importPreviewRepository = {
  async create(input: {
    id: string;
    userId: string;
    payload: Prisma.InputJsonValue;
    expiresAt: Date;
  }): Promise<void> {
    await prisma.importPreview.create({
      data: {
        id: input.id,
        userId: input.userId,
        payload: input.payload,
        expiresAt: input.expiresAt,
      },
    });
  },

  /** Aperçu encore valable : bon propriétaire, non expiré, non consommé. */
  async findUsable(id: string, userId: string, now: Date): Promise<StoredPreviewRow | null> {
    return prisma.importPreview.findFirst({
      where: { id, userId, consumedAt: null, expiresAt: { gt: now } },
    });
  },

  /**
   * Consommation **unique**, gagnée par une seule requête.
   *
   * `updateMany` conditionné sur `consumedAt: null` est atomique côté
   * PostgreSQL : deux confirmations simultanées du même aperçu ne peuvent pas
   * toutes les deux renvoyer 1. Le résultat dit qui a gagné.
   */
  async consume(id: string, userId: string, now: Date): Promise<boolean> {
    const result = await prisma.importPreview.updateMany({
      where: { id, userId, consumedAt: null },
      data: { consumedAt: now },
    });

    return result.count === 1;
  },

  /** Purge les aperçus échus : aucune donnée de relevé ne survit à son TTL. */
  async purgeExpired(now: Date): Promise<number> {
    const result = await prisma.importPreview.deleteMany({
      where: { expiresAt: { lte: now } },
    });

    return result.count;
  },
};
