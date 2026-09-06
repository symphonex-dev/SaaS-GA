import type { AuthSession, Subscription, User } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

/**
 * Accès aux `AuthSession` (`specs/auth-comptes-rgpd.md` §4).
 * Seule l'empreinte du token circule ici : le token brut n'entre jamais dans
 * cette couche.
 */
/**
 * L'abonnement accompagne l'utilisateur : `User.tier` est une projection de
 * `Subscription.plan` (`specs/schema-donnees.md` §3), et l'offre en vigueur se
 * resout depuis l'abonnement, jamais depuis la colonne seule
 * (`specs/paiement-in-app.md` §7). L'inclure ici evite une requete
 * supplementaire sur chaque requete authentifiee.
 */
export type AuthSessionWithUser = AuthSession & {
  user: User & { subscription: Subscription | null };
};

export interface CreateSessionData {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  deviceLabel: string | null;
}

export const authSessionRepository = {
  async create(data: CreateSessionData): Promise<AuthSession> {
    return prisma.authSession.create({ data });
  },

  async findByTokenHash(tokenHash: string): Promise<AuthSessionWithUser | null> {
    return prisma.authSession.findUnique({
      where: { tokenHash },
      include: { user: { include: { subscription: true } } },
    });
  },

  /**
   * Fenêtre glissante : chaque usage repousse l'expiration et met à jour
   * `lastUsedAt` (§4).
   */
  async touch(id: string, usedAt: Date, expiresAt: Date): Promise<void> {
    await prisma.authSession.update({
      where: { id },
      data: { lastUsedAt: usedAt, expiresAt },
    });
  },

  /** Déconnexion : la révocation serveur est ce qui rend la déconnexion réelle. */
  async revoke(id: string, revokedAt: Date): Promise<void> {
    await prisma.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt },
    });
  },

  /**
   * Révoque toutes les sessions encore actives d'un utilisateur.
   * Utilisé à la suppression de compte (§9) et après une réinitialisation de
   * mot de passe.
   */
  async revokeAllForUser(userId: string, revokedAt: Date): Promise<number> {
    const result = await prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });

    return result.count;
  },

  async listForUser(userId: string): Promise<AuthSession[]> {
    return prisma.authSession.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  },
};
