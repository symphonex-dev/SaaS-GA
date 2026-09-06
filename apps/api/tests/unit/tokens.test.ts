import { describe, expect, it } from 'vitest';

import {
  generatePasswordResetToken,
  generateSessionToken,
  hashPasswordResetToken,
  hashSessionToken,
  tokenHashesMatch,
} from '@/lib/security/tokens';

/** `specs/auth-comptes-rgpd.md` §4 et §5 — tokens opaques, stockés hachés. */
describe('tokens opaques', () => {
  it('génère un token base64url de 256 bits', () => {
    const token = generateSessionToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('ne génère jamais deux fois le même token', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateSessionToken()));

    expect(tokens.size).toBe(500);
  });

  it('applique le même schéma aux tokens de réinitialisation', () => {
    const token = generatePasswordResetToken();

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('produit une empreinte SHA-256 déterministe et distincte du token', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);

    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    expect(hashSessionToken(token)).toBe(hash);
  });

  it('produit des empreintes différentes pour des tokens différents', () => {
    expect(hashSessionToken(generateSessionToken())).not.toBe(
      hashSessionToken(generateSessionToken()),
    );
  });

  it('hache les tokens de réinitialisation avec le même algorithme', () => {
    const token = generatePasswordResetToken();

    expect(hashPasswordResetToken(token)).toBe(hashSessionToken(token));
  });

  it('compare deux empreintes à temps constant', () => {
    const hash = hashSessionToken(generateSessionToken());

    expect(tokenHashesMatch(hash, hash)).toBe(true);
    expect(tokenHashesMatch(hash, hashSessionToken(generateSessionToken()))).toBe(false);
    expect(tokenHashesMatch(hash, 'trop-court')).toBe(false);
  });
});
