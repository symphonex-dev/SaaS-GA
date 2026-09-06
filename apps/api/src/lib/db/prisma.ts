import { PrismaClient } from '@prisma/client';

/**
 * Client Prisma unique du process.
 *
 * En développement, Next.js recharge les modules à chaud : sans ce cache global
 * chaque rechargement ouvrirait un nouveau pool de connexions.
 *
 * Rappels (CLAUDE.md §2.2) : aucune requête Prisma ne doit être écrite dans un
 * route handler — l'accès à ce client est réservé aux repositories. Toute
 * requête portant sur une ressource privée filtre par `userId` (§5.3).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
