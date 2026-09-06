/**
 * Détection d'encodage CSV (`specs/import-releves.md` §4.1).
 *
 * Deux encodages supportés : UTF-8 (avec ou sans BOM) et ISO-8859-1 en repli.
 * Les accents doivent survivre au décodage (« Électricité », « Crédit
 * Agricole ») : c'est le critère de correction de ce module.
 */
export type CsvEncoding = 'utf-8' | 'utf-8-bom' | 'iso-8859-1';

export interface DecodedCsv {
  encoding: CsvEncoding;
  text: string;
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];

function hasUtf8Bom(buffer: Buffer): boolean {
  return UTF8_BOM.every((byte, index) => buffer[index] === byte);
}

/**
 * Décode le contenu d'un fichier CSV.
 *
 * UTF-8 est tenté en mode strict : un octet invalide déclenche une exception,
 * ce qui est le signal fiable qu'il s'agit d'ISO-8859-1. Deviner à partir de
 * fréquences de caractères serait moins déterministe.
 */
export function decodeCsvBuffer(buffer: Buffer): DecodedCsv {
  const bom = hasUtf8Bom(buffer);
  const payload = bom ? buffer.subarray(UTF8_BOM.length) : buffer;

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
    return { encoding: bom ? 'utf-8-bom' : 'utf-8', text };
  } catch {
    // Repli ISO-8859-1 : tout octet y est décodable, la conversion ne peut pas échouer.
    return { encoding: 'iso-8859-1', text: new TextDecoder('iso-8859-1').decode(payload) };
  }
}

/**
 * Détecte un contenu binaire : un CSV ne contient jamais d'octet NUL.
 * Sert à rejeter un `.exe`, `.zip` ou `.png` renommé en `.csv` (§3, §11).
 */
export function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192);

  return sample.includes(0x00);
}
