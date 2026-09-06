import { TIER_BY_PLAN } from '@subscription-manager/shared';
import type { BillingCycle, StorePlatform, Subscription } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

/**
 * Accès aux `Subscription`.
 *
 * L'abonnement est toujours lu par `userId` (relation 1-1) : aucune route ne
 * permet d'atteindre l'abonnement d'un autre utilisateur
 * (`specs/auth-comptes-rgpd.md` §11).
 *
 * Toutes les écritures d'ici viennent d'une vérification auprès du store ou
 * d'une notification serveur (`specs/paiement-in-app.md` §1) : aucune route ne
 * laisse un client fixer son propre plan.
 */
export interface SubscriptionWriteData {
  store?: StorePlatform | null;
  storeProductId?: string | null;
  storeTransactionId?: string | null;
  storeOriginalTransactionId?: string | null;
  plan?: 'FREE' | 'PLUS';
  status?: Subscription['status'];
  billingCycle?: BillingCycle | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
}

export const subscriptionRepository = {
  async findByUserId(userId: string): Promise<Subscription | null> {
    return prisma.subscription.findUnique({ where: { userId } });
  },

  /**
   * Retrouve l'abonnement visé par une notification de store.
   *
   * La recherche porte sur les identifiants du store, jamais sur une donnée
   * fournie par un client : c'est le seul chemin par lequel une notification
   * peut être rattachée à un compte.
   */
  async findByStoreReference(
    store: StorePlatform,
    reference: { transactionId?: string; originalTransactionId?: string },
  ): Promise<Subscription | null> {
    if (reference.originalTransactionId !== undefined) {
      const byOriginal = await prisma.subscription.findFirst({
        where: { store, storeOriginalTransactionId: reference.originalTransactionId },
      });

      if (byOriginal !== null) {
        return byOriginal;
      }
    }

    if (reference.transactionId === undefined) {
      return null;
    }

    return prisma.subscription.findFirst({
      where: { store, storeTransactionId: reference.transactionId },
    });
  },

  /** Détenteur actuel d'un achat, pour refuser le partage d'un même jeton. */
  async findByOriginalTransactionId(
    store: StorePlatform,
    originalTransactionId: string,
  ): Promise<Subscription | null> {
    return prisma.subscription.findFirst({
      where: { store, storeOriginalTransactionId: originalTransactionId },
    });
  },

  /**
   * Écrit l'état de l'abonnement d'un utilisateur, en créant la ligne au
   * besoin. Une seule ligne par utilisateur (`userId` unique au schéma).
   *
   * `User.tier` est resynchronisé dans la **même transaction** : la colonne est
   * une projection de `Subscription.plan` (`specs/schema-donnees.md` §3), elle
   * ne doit jamais diverger de l'abonnement qui vient d'être écrit. Elle sert
   * aux index et aux exports ; l'autorité à la lecture reste `effectivePlan()`.
   */
  async save(userId: string, data: SubscriptionWriteData): Promise<Subscription> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.subscription.findUnique({ where: { userId } });

      const saved =
        existing === null
          ? await tx.subscription.create({ data: { userId, ...data } })
          : await tx.subscription.update({
              where: { userId },
              data: { ...data, updatedAt: new Date() },
            });

      await tx.user.updateMany({
        where: { id: userId },
        data: { tier: TIER_BY_PLAN[saved.plan === 'PLUS' ? 'PLUS' : 'FREE'] },
      });

      return saved;
    });
  },

  /**
   * Abonnements payants dont la période est échue.
   *
   * Filet de secours de `specs/paiement-in-app.md` §6, pour le cas où la
   * notification d'expiration du store n'arriverait jamais.
   */
  async listOverduePaid(now: Date): Promise<Subscription[]> {
    return prisma.subscription.findMany({
      where: { plan: 'PLUS', currentPeriodEnd: { lt: now } },
      orderBy: { createdAt: 'asc' },
    });
  },
};
