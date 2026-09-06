import { Prisma } from '@prisma/client';
import type { StorePlatform } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

/**
 * Idempotence des notifications serveur des stores
 * (`specs/paiement-in-app.md` §5, point 2 ; `specs/schema-donnees.md` §13).
 *
 * L'identifiant vient du store et sert de clé primaire. L'idempotence repose
 * donc sur l'**insertion elle-même** : la contrainte de clé primaire est
 * atomique, là où un « lire puis écrire » laisserait passer deux traitements
 * concurrents du même événement rejoué.
 */
export const storeNotificationRepository = {
  /**
   * Réserve un identifiant d'événement.
   *
   * @returns `true` si l'événement est nouveau et doit être traité, `false`
   *   s'il a déjà été enregistré — la notification est alors simplement
   *   acquittée.
   */
  async claim(id: string, store: StorePlatform, type: string): Promise<boolean> {
    try {
      await prisma.storeNotificationEvent.create({ data: { id, store, type } });

      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }

      throw error;
    }
  },

  /** Marque l'événement comme traité, une fois l'abonnement mis à jour. */
  async markProcessed(id: string, processedAt: Date): Promise<void> {
    await prisma.storeNotificationEvent.updateMany({ where: { id }, data: { processedAt } });
  },

  async findById(id: string): Promise<{ processedAt: Date | null } | null> {
    return prisma.storeNotificationEvent.findUnique({
      where: { id },
      select: { processedAt: true },
    });
  },
};
