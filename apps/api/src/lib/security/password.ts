import { hash, verify, type Algorithm } from '@node-rs/argon2';

/**
 * Hachage de mot de passe (`specs/auth-comptes-rgpd.md` §3).
 *
 * Argon2id via `@node-rs/argon2` : binaire précompilé (aucune chaîne de
 * compilation C requise sur les machines de développement ni en CI), donc pas
 * de repli sur bcrypt à documenter.
 *
 * Jamais de MD5, SHA-1, SHA-256 seul, Base64 ni chiffrement réversible.
 * Aucun mot de passe et aucun hash ne doit être journalisé.
 */

/**
 * `Algorithm.Argon2id` de `@node-rs/argon2`. La valeur numérique est reprise
 * ici parce que l'enum de la bibliothèque est un `const enum` ambient,
 * inutilisable sous `isolatedModules` (imposé par le tsconfig du projet).
 */
const ARGON2ID: Algorithm = 2;

/**
 * Paramètres Argon2id. Alignés sur les recommandations OWASP (19 Mio de
 * mémoire, 2 passes, parallélisme 1) : coût suffisant côté serveur, sans
 * pénaliser une connexion mobile.
 */
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Vérifie un mot de passe contre son empreinte.
 * Renvoie `false` (jamais une exception) si l'empreinte stockée est illisible,
 * pour qu'un enregistrement corrompu se comporte comme un échec d'identifiants
 * et ne révèle rien de plus.
 */
export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
