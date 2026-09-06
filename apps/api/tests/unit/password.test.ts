import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '@/lib/security/password';

/** `specs/auth-comptes-rgpd.md` §3 — hachage Argon2id. */
describe('hachage de mot de passe', () => {
  const password = 'MotDePasseTresLong2026';

  it('produit une empreinte Argon2id', async () => {
    const hash = await hashPassword(password);

    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('ne contient jamais le mot de passe en clair', async () => {
    const hash = await hashPassword(password);

    expect(hash).not.toContain(password);
  });

  it('produit deux empreintes différentes pour le même mot de passe (sel aléatoire)', async () => {
    const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)]);

    expect(first).not.toBe(second);
  });

  it('vérifie un mot de passe correct', async () => {
    const hash = await hashPassword(password);

    await expect(verifyPassword(password, hash)).resolves.toBe(true);
  });

  it('rejette un mot de passe incorrect', async () => {
    const hash = await hashPassword(password);

    await expect(verifyPassword('MauvaisMotDePasse2026', hash)).resolves.toBe(false);
  });

  it("renvoie false sans lever d'exception sur une empreinte corrompue", async () => {
    await expect(verifyPassword(password, 'pas-une-empreinte')).resolves.toBe(false);
  });

  it('accepte les caractères non ASCII', async () => {
    const complexe = 'Mot de passe éèàüñ 2026 ✓';
    const hash = await hashPassword(complexe);

    await expect(verifyPassword(complexe, hash)).resolves.toBe(true);
  });
});
