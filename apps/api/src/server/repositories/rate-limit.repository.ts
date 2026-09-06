import { prisma } from '@/lib/db/prisma';

/**
 * Compteur de rate limiting partagé (`specs/auth-comptes-rgpd.md` §10).
 *
 * L'incrément est fait par **un seul énoncé SQL** : `INSERT … ON CONFLICT DO
 * UPDATE … RETURNING`. C'est le point d'atomicité — deux requêtes concurrentes,
 * sur deux instances, ne peuvent pas lire la même valeur puis l'écrire toutes
 * les deux. Une lecture suivie d'une écriture laisserait passer le double de la
 * limite sous charge, ce qui est exactement le cas que le rate limiting doit
 * couvrir.
 *
 * La clé est opaque : `domaine:identifiant:début de fenêtre`. Elle n'est jamais
 * journalisée — l'identifiant peut être une adresse IP ou un `userId`
 * (CLAUDE.md §6).
 */
interface CounterRow {
  count: number;
}

export const rateLimitRepository = {
  /**
   * Incrémente la fenêtre et renvoie le compteur **après** incrément.
   *
   * `expiresAt` n'est posé qu'à la création : une fenêtre fixe ne glisse pas,
   * sinon un flux continu de requêtes la repousserait indéfiniment.
   */
  async increment(key: string, expiresAt: Date): Promise<number> {
    const rows = await prisma.$queryRaw<CounterRow[]>`
      INSERT INTO rate_limit_counters (key, count, expires_at)
      VALUES (${key}, 1, ${expiresAt})
      ON CONFLICT (key) DO UPDATE
        SET count = rate_limit_counters.count + 1
      RETURNING count
    `;

    return rows[0]?.count ?? 1;
  },

  /**
   * Supprime les fenêtres échues.
   *
   * Appelée au fil de l'eau, jamais dans le chemin critique d'une requête : la
   * clé porte le début de fenêtre, une ligne périmée n'est donc plus jamais
   * lue, seulement stockée.
   */
  async purgeExpired(now: Date): Promise<number> {
    const result = await prisma.rateLimitCounter.deleteMany({
      where: { expiresAt: { lte: now } },
    });

    return result.count;
  },
};
