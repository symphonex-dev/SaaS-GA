import { createPrivateKey, createSign, randomUUID, sign as signRaw } from 'node:crypto';

/**
 * Signature des jetons d'accès aux API des stores
 * (`specs/paiement-in-app.md` §3).
 *
 * Google exige un JWT RS256 signé par la clé du compte de service ; Apple
 * exige un JWT ES256 signé par la clé de l'App Store Server API. Les deux clés
 * ne vivent que côté `apps/api` et ne sont jamais journalisées.
 *
 * Implémenté sur `node:crypto` seul : aucune dépendance supplémentaire pour
 * deux signatures dont le format est entièrement spécifié.
 */
function base64Url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodeSegment(payload: object): string {
  return base64Url(JSON.stringify(payload));
}

/** JWT RS256 — jeton d'accès OAuth2 d'un compte de service Google. */
export function signRs256(header: object, payload: object, privateKeyPem: string): string {
  const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
  const signer = createSign('RSA-SHA256');

  signer.update(signingInput);
  signer.end();

  return `${signingInput}.${base64Url(signer.sign(createPrivateKey(privateKeyPem)))}`;
}

/**
 * JWT ES256 — App Store Server API.
 *
 * `dsaEncoding: 'ieee-p1363'` est indispensable : JOSE attend la concaténation
 * brute `R || S`, alors que Node produit du DER par défaut.
 */
export function signEs256(header: object, payload: object, privateKeyPem: string): string {
  const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
  const signature = signRaw('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(privateKeyPem),
    dsaEncoding: 'ieee-p1363',
  });

  return `${signingInput}.${base64Url(signature)}`;
}

/** Identifiant unique d'un jeton, exigé par l'App Store Server API. */
export function tokenId(): string {
  return randomUUID();
}

/** Secondes depuis l'epoch : unité attendue par `iat` / `exp`. */
export function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
