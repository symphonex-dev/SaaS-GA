import type { User } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

/**
 * Accès aux `User`. Seule couche autorisée à parler à Prisma pour cette table
 * (CLAUDE.md §2.2).
 *
 * Un compte « supprimé » (`deletedAt !== null`) n'est jamais renvoyé : il ne
 * doit plus pouvoir s'authentifier (`specs/auth-comptes-rgpd.md` §9).
 */
export interface CreateUserData {
  email: string;
  passwordHash: string;
  language: string;
  country: string;
  currency: string;
}

export const userRepository = {
  /** L'e-mail est normalisé en minuscules en amont, par le schéma Zod. */
  async findActiveByEmail(email: string): Promise<User | null> {
    return prisma.user.findFirst({ where: { email, deletedAt: null } });
  },

  async findActiveById(id: string): Promise<User | null> {
    return prisma.user.findFirst({ where: { id, deletedAt: null } });
  },

  async emailExists(email: string): Promise<boolean> {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    return existing !== null;
  },

  async create(data: CreateUserData): Promise<User> {
    return prisma.user.create({ data });
  },

  /**
   * Met à jour les préférences de l'utilisateur de la session.
   * `id` provient toujours de `requireUser()`, jamais du corps de la requête
   * (`specs/auth-comptes-rgpd.md` §6).
   */
  async updatePreferences(
    id: string,
    preferences: { language: string; country: string; currency: string },
  ): Promise<User> {
    return prisma.user.update({ where: { id }, data: preferences });
  },

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await prisma.user.update({ where: { id }, data: { passwordHash } });
  },
};
