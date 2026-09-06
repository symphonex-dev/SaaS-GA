import { generateKeyPairSync, verify as verifyRaw } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { decodeJws, verifyAppleJws } from '@/lib/billing/jws';
import { epochSeconds, signEs256, signRs256 } from '@/lib/billing/jwt';

import { unsignedJws } from '../helpers/billing';

/**
 * Signature des jetons d'accès et vérification des charges Apple
 * (`specs/paiement-in-app.md` §3 et §5).
 */
function decodeJwtSegment(token: string, index: number): Record<string, unknown> {
  const segment = token.split('.')[index] ?? '';

  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('signature des jetons d’accès aux stores (§3)', () => {
  it('produit un JWT RS256 vérifiable (compte de service Google)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const token = signRs256(
      { alg: 'RS256', typ: 'JWT' },
      { iss: 'compte@exemple.iam.gserviceaccount.com', iat: 0, exp: 3600 },
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );

    const [header, payload, signature] = token.split('.');

    expect(decodeJwtSegment(token, 0)['alg']).toBe('RS256');
    expect(decodeJwtSegment(token, 1)['iss']).toBe('compte@exemple.iam.gserviceaccount.com');
    expect(
      verifyRaw(
        'sha256',
        Buffer.from(`${String(header)}.${String(payload)}`),
        publicKey,
        Buffer.from(String(signature), 'base64url'),
      ),
    ).toBe(true);
  });

  it('produit un JWT ES256 au format JOSE (App Store Server API)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const token = signEs256(
      { alg: 'ES256', kid: 'ABC123', typ: 'JWT' },
      { iss: 'issuer', aud: 'appstoreconnect-v1', iat: 0, exp: 600 },
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );

    const [header, payload, signature] = token.split('.');
    const raw = Buffer.from(String(signature), 'base64url');

    // JOSE impose la concaténation brute R || S : 64 octets, jamais du DER.
    expect(raw).toHaveLength(64);
    expect(
      verifyRaw(
        'sha256',
        Buffer.from(`${String(header)}.${String(payload)}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        raw,
      ),
    ).toBe(true);
  });

  it('exprime les dates en secondes depuis l’epoch', () => {
    expect(epochSeconds(new Date('2026-08-15T12:00:00.000Z'))).toBe(1_786_795_200);
  });
});

describe('vérification des charges Apple (§5, point 1)', () => {
  const ROOT_CA = 'Y2VydGlmaWNhdC1yYWNpbmUtZmFjdGljZQ==';
  const NOW = new Date('2026-08-15T12:00:00.000Z');

  it('décode un JWS sans le vérifier, pour les charges déjà validées', () => {
    const decoded = decodeJws(unsignedJws({ transactionId: 'txn_1' }));

    expect(decoded?.payload['transactionId']).toBe('txn_1');
    expect(decodeJws('pas-un-jws')).toBeNull();
  });

  it('refuse une charge sans certificat racine configuré', () => {
    expect(verifyAppleJws(unsignedJws({ notificationType: 'EXPIRED' }), '', NOW).valid).toBe(false);
  });

  it('refuse une charge sans chaîne de certificats', () => {
    // Aucun `x5c` : rien ne rattache la signature à Apple.
    expect(verifyAppleJws(unsignedJws({ notificationType: 'EXPIRED' }), ROOT_CA, NOW).valid).toBe(
      false,
    );
  });

  it('refuse un algorithme autre qu’ES256', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', x5c: ['a', 'b'] })).toString(
      'base64url',
    );
    const payload = Buffer.from(JSON.stringify({ notificationType: 'EXPIRED' })).toString(
      'base64url',
    );

    expect(verifyAppleJws(`${header}.${payload}.`, ROOT_CA, NOW).valid).toBe(false);
  });

  it('refuse une chaîne de certificats illisible', () => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'ES256', x5c: ['pas-du-der', 'non-plus'] }),
    ).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ notificationType: 'EXPIRED' })).toString(
      'base64url',
    );

    expect(verifyAppleJws(`${header}.${payload}.sig`, ROOT_CA, NOW).valid).toBe(false);
  });

  it('refuse une charge malformée', () => {
    expect(verifyAppleJws('', ROOT_CA, NOW).valid).toBe(false);
    expect(verifyAppleJws('a.b', ROOT_CA, NOW).valid).toBe(false);
  });
});
