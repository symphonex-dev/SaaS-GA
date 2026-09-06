import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Tokens opaques (`specs/auth-comptes-rgpd.md` §4 et §5).
 *
 * Deux familles, même schéma de génération et de stockage :
 *  - token de session, renvoyé une seule fois au client mobile, qui le range
 *    dans `expo-secure-store` ;
 *  - token de réinitialisation de mot de passe, transmis par e-mail.
 *
 * Le token brut n'est jamais stocké ni journalisé : seule son empreinte
 * SHA-256 est persistée (`AuthSession.tokenHash`,
 * `PasswordResetToken.tokenHash`).
 *
 * SHA-256 sans facteur de coût est ici volontaire et suffisant : contrairement
 * à un mot de passe, ces tokens sont des valeurs aléatoires de 256 bits, hors
 * de portée d'une attaque par dictionnaire ou par force brute.
 */

const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generatePasswordResetToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Comparaison d'empreintes à temps constant, pour les cas où deux empreintes
 * sont comparées en mémoire plutôt que via une recherche indexée en base.
 */
export function tokenHashesMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}
