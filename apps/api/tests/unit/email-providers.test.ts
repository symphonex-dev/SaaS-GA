import { registerSchema } from '@subscription-manager/shared';
import { describe, expect, it } from 'vitest';

/**
 * `specs/auth-comptes-rgpd.md` §2 — l'inscription doit fonctionner avec
 * n'importe quelle adresse valide au sens RFC, sans liste blanche de domaines.
 *
 * Les fournisseurs listés dans la spec sont couverts explicitement : une
 * régression qui ajouterait un filtrage de domaine casserait ces tests.
 */
const validPayload = {
  password: 'MotDePasseTresLong2026',
  language: 'fr' as const,
  country: 'FR' as const,
  currency: 'EUR' as const,
};

const REQUIRED_PROVIDERS = [
  'personne@gmail.com',
  'personne@outlook.com',
  'personne@hotmail.com',
  'personne@live.com',
  'personne@protonmail.com',
  'personne@proton.me',
  'personne@tutanota.com',
  'personne@tuta.com',
  'personne@yahoo.com',
  'personne@yahoo.fr',
  'personne@orange.fr',
  'personne@wanadoo.fr',
  'personne@laposte.net',
];

describe("acceptation des fournisseurs d'e-mail", () => {
  it.each(REQUIRED_PROVIDERS)('accepte %s', (email) => {
    const result = registerSchema.safeParse({ ...validPayload, email });

    expect(result.success).toBe(true);
  });

  it('accepte un domaine personnalisé (aucune liste blanche)', () => {
    const result = registerSchema.safeParse({
      ...validPayload,
      email: 'contact@mon-domaine-perso.example',
    });

    expect(result.success).toBe(true);
  });

  it('normalise la casse et les espaces avant stockage', () => {
    const result = registerSchema.parse({ ...validPayload, email: '  Personne@Gmail.COM  ' });

    expect(result.email).toBe('personne@gmail.com');
  });

  it.each(['abc', 'a@b', '', 'sans-arobase.fr', 'deux@@arobases.fr', 'espace dans@mail.fr'])(
    'rejette le format invalide %j',
    (email) => {
      const result = registerSchema.safeParse({ ...validPayload, email });

      expect(result.success).toBe(false);
    },
  );

  it("n'applique aucun traitement particulier à un client de messagerie", () => {
    // Samsung Email et Thunderbird sont des clients, pas des domaines :
    // aucune logique ne doit tenter de les détecter (spec §2).
    const viaClient = registerSchema.safeParse({
      ...validPayload,
      email: 'personne@laposte.net',
    });

    expect(viaClient.success).toBe(true);
  });
});

describe('politique de mot de passe (§3)', () => {
  it('rejette un mot de passe de moins de 12 caractères', () => {
    const result = registerSchema.safeParse({
      ...validPayload,
      email: 'personne@gmail.com',
      password: 'court123',
    });

    expect(result.success).toBe(false);
  });

  it('rejette un mot de passe de plus de 128 caractères', () => {
    const result = registerSchema.safeParse({
      ...validPayload,
      email: 'personne@gmail.com',
      password: 'a'.repeat(129),
    });

    expect(result.success).toBe(false);
  });

  it('accepte exactement 12 caractères', () => {
    const result = registerSchema.safeParse({
      ...validPayload,
      email: 'personne@gmail.com',
      password: 'a'.repeat(12),
    });

    expect(result.success).toBe(true);
  });
});
