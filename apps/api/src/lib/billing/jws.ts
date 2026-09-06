import { X509Certificate, verify as verifyRaw } from 'node:crypto';

/**
 * Vérification des charges signées par Apple
 * (`specs/paiement-in-app.md` §5, point 1).
 *
 * Une notification App Store Server V2 est un JWS ES256 dont l'en-tête porte la
 * chaîne de certificats `x5c` : feuille → intermédiaire → racine Apple. Sont
 * vérifiés, dans cet ordre :
 *
 *  1. la signature de la charge par la clé publique du certificat feuille ;
 *  2. le chaînage feuille ← intermédiaire ← racine ;
 *  3. l'égalité de la racine avec le certificat racine Apple **configuré**
 *     (`APP_STORE_ROOT_CA`), publié par Apple et jamais fabriqué par nous ;
 *  4. la validité temporelle de chaque certificat.
 *
 * Sans racine configurée, la vérification échoue : la sécurité échoue toujours
 * du côté fermé.
 */
export interface DecodedJws {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

function decodeSegment(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Décode un JWS **sans rien vérifier**.
 *
 * Réservé à la lecture de charges déjà vérifiées, et aux tests. Ne jamais s'en
 * servir pour décider d'un changement d'abonnement.
 */
export function decodeJws(token: string): DecodedJws | null {
  const [headerSegment, payloadSegment] = token.split('.');

  if (headerSegment === undefined || payloadSegment === undefined) {
    return null;
  }

  const header = asRecord(decodeSegment(headerSegment));
  const payload = asRecord(decodeSegment(payloadSegment));

  return header === null || payload === null ? null : { header, payload };
}

function certificateChain(header: Record<string, unknown>): X509Certificate[] | null {
  const x5c = header['x5c'];

  if (!Array.isArray(x5c) || x5c.length < 2) {
    return null;
  }

  const certificates: X509Certificate[] = [];

  for (const entry of x5c) {
    if (typeof entry !== 'string') {
      return null;
    }

    try {
      certificates.push(new X509Certificate(Buffer.from(entry, 'base64')));
    } catch {
      return null;
    }
  }

  return certificates;
}

function isWithinValidity(certificate: X509Certificate, now: Date): boolean {
  return (
    new Date(certificate.validFrom).getTime() <= now.getTime() &&
    now.getTime() <= new Date(certificate.validTo).getTime()
  );
}

export interface JwsVerification {
  /** `true` uniquement si les quatre contrôles ci-dessus réussissent. */
  valid: boolean;
  payload: Record<string, unknown> | null;
}

/**
 * Vérifie un JWS signé par Apple.
 *
 * @param rootCaBase64 certificat racine Apple, DER encodé en base64. Chaîne
 *   vide = aucune racine de confiance, donc refus systématique.
 */
export function verifyAppleJws(
  token: string,
  rootCaBase64: string,
  now: Date = new Date(),
): JwsVerification {
  const decoded = decodeJws(token);
  const [headerSegment, payloadSegment, signatureSegment] = token.split('.');

  if (
    decoded === null ||
    headerSegment === undefined ||
    payloadSegment === undefined ||
    signatureSegment === undefined ||
    rootCaBase64.length === 0
  ) {
    return { valid: false, payload: null };
  }

  if (decoded.header['alg'] !== 'ES256') {
    // Le seul algorithme employé par Apple. Refuser tout le reste ferme la
    // porte aux substitutions d'algorithme (« alg: none » et apparentées).
    return { valid: false, payload: null };
  }

  const chain = certificateChain(decoded.header);

  if (chain === null) {
    return { valid: false, payload: null };
  }

  const leaf = chain[0];
  const root = chain[chain.length - 1];

  if (leaf === undefined || root === undefined) {
    return { valid: false, payload: null };
  }

  let expectedRoot: X509Certificate;

  try {
    expectedRoot = new X509Certificate(Buffer.from(rootCaBase64, 'base64'));
  } catch {
    return { valid: false, payload: null };
  }

  // Racine épinglée : une chaîne complète mais issue d'une autre autorité est
  // rejetée, même si elle est cohérente avec elle-même.
  if (!root.raw.equals(expectedRoot.raw)) {
    return { valid: false, payload: null };
  }

  for (const certificate of chain) {
    if (!isWithinValidity(certificate, now)) {
      return { valid: false, payload: null };
    }
  }

  for (let index = 0; index < chain.length - 1; index += 1) {
    const child = chain[index];
    const parent = chain[index + 1];

    if (child === undefined || parent === undefined || !child.verify(parent.publicKey)) {
      return { valid: false, payload: null };
    }
  }

  const signatureValid = verifyRaw(
    'sha256',
    Buffer.from(`${headerSegment}.${payloadSegment}`),
    { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signatureSegment, 'base64url'),
  );

  return signatureValid
    ? { valid: true, payload: decoded.payload }
    : { valid: false, payload: null };
}

/**
 * Vérificateur injectable.
 *
 * L'implémentation par défaut est celle ci-dessus. L'injection existe pour les
 * tests : fabriquer une chaîne X.509 complète depuis Node n'est pas possible
 * (l'API de `node:crypto` ne crée pas de certificats). Les tests de rejet, eux,
 * exercent bien le vérificateur réel.
 */
export type JwsVerifier = (token: string, now: Date) => JwsVerification;

let verifier: JwsVerifier | null = null;

export function setJwsVerifierForTesting(override: JwsVerifier | null): void {
  verifier = override;
}

export function verifySignedPayload(
  token: string,
  rootCaBase64: string,
  now: Date = new Date(),
): JwsVerification {
  return verifier === null ? verifyAppleJws(token, rootCaBase64, now) : verifier(token, now);
}
