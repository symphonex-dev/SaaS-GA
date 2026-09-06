import { ERROR_CODES, type ImportSourceType } from '@subscription-manager/shared';

import { AppError } from '@/lib/api/errors';
import { looksBinary } from '@/lib/csv/encoding';
import { hasPdfSignature } from '@/lib/pdf/extract';

/**
 * Contrôles de fichier avant tout traitement
 * (`specs/import-releves.md` §3 et §11).
 *
 * Le type MIME annoncé par le client est indicatif et **jamais suffisant** :
 * l'extension, la taille et le contenu réel sont revérifiés côté serveur. Un
 * `.exe`, `.zip`, `.jpg` ou `.png` renommé en `.csv` ou `.pdf` est rejeté.
 */
const CSV_MIME_TYPES = [
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'text/plain',
  '', // certains clients mobiles n'envoient aucun type
  'application/octet-stream',
];

const PDF_MIME_TYPES = ['application/pdf', '', 'application/octet-stream'];

/** Signatures de fichiers explicitement refusés, même renommés. */
const FORBIDDEN_SIGNATURES: Array<{ label: string; bytes: number[] }> = [
  { label: 'ZIP/Office', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { label: 'Exécutable Windows', bytes: [0x4d, 0x5a] },
  { label: 'Exécutable ELF', bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { label: 'PNG', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { label: 'JPEG', bytes: [0xff, 0xd8, 0xff] },
  { label: 'GIF', bytes: [0x47, 0x49, 0x46, 0x38] },
  { label: 'RAR', bytes: [0x52, 0x61, 0x72, 0x21] },
  { label: 'GZIP', bytes: [0x1f, 0x8b] },
  { label: 'Document Office ancien', bytes: [0xd0, 0xcf, 0x11, 0xe0] },
];

/** Contenus actifs interdits dans un fichier texte (§11). */
const ACTIVE_CONTENT_PATTERNS = [
  /<script\b/i,
  /<\?php\b/i,
  /<!doctype\s+html/i,
  /<html\b/i,
  /^\s*<\?xml/i,
];

export interface UploadedFile {
  filename: string | null;
  mimeType: string;
  content: Buffer;
}

function matchesSignature(buffer: Buffer, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function extensionOf(filename: string | null): string {
  if (filename === null) {
    return '';
  }

  const lastDot = filename.lastIndexOf('.');

  return lastDot === -1 ? '' : filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Détermine le type d'import à partir de l'extension et du contenu réel.
 * Les deux doivent concorder : un fichier `.csv` commençant par `%PDF-` est
 * rejeté, tout comme un `.pdf` qui n'en est pas un.
 */
export function resolveSourceType(file: UploadedFile): ImportSourceType {
  const extension = extensionOf(file.filename);

  for (const signature of FORBIDDEN_SIGNATURES) {
    if (matchesSignature(file.content, signature.bytes)) {
      throw new AppError(
        ERROR_CODES.IMPORT_FILE_INVALID,
        `Type de fichier non autorisé (${signature.label}).`,
        'file',
      );
    }
  }

  if (extension === 'pdf') {
    if (!PDF_MIME_TYPES.includes(file.mimeType) && !file.mimeType.includes('pdf')) {
      throw new AppError(ERROR_CODES.IMPORT_FILE_INVALID, 'Type MIME incohérent.', 'file');
    }

    if (!hasPdfSignature(file.content)) {
      throw new AppError(
        ERROR_CODES.IMPORT_FILE_INVALID,
        "Le contenu n'est pas un PDF valide.",
        'file',
      );
    }

    return 'PDF';
  }

  if (extension === 'csv' || extension === 'txt' || extension === '') {
    if (!CSV_MIME_TYPES.includes(file.mimeType) && !file.mimeType.startsWith('text/')) {
      throw new AppError(ERROR_CODES.IMPORT_FILE_INVALID, 'Type MIME incohérent.', 'file');
    }

    if (hasPdfSignature(file.content)) {
      throw new AppError(
        ERROR_CODES.IMPORT_FILE_INVALID,
        'Fichier PDF présenté avec une extension CSV.',
        'file',
      );
    }

    if (looksBinary(file.content)) {
      throw new AppError(
        ERROR_CODES.IMPORT_FILE_INVALID,
        'Contenu binaire non reconnu pour un CSV.',
        'file',
      );
    }

    return 'CSV';
  }

  throw new AppError(
    ERROR_CODES.IMPORT_FILE_INVALID,
    `Extension non supportée : .${extension}`,
    'file',
  );
}

export function assertFileSize(content: Buffer, maxBytes: number): void {
  if (content.byteLength === 0) {
    throw new AppError(ERROR_CODES.IMPORT_FILE_INVALID, 'Fichier vide.', 'file');
  }

  if (content.byteLength > maxBytes) {
    throw new AppError(
      ERROR_CODES.IMPORT_FILE_TOO_LARGE,
      `Fichier trop volumineux (limite : ${String(maxBytes)} octets).`,
      'file',
    );
  }
}

/** Refuse un CSV contenant du HTML, du script ou du XML (§11). */
export function assertNoActiveContent(text: string): void {
  const sample = text.slice(0, 4096);

  for (const pattern of ACTIVE_CONTENT_PATTERNS) {
    if (pattern.test(sample)) {
      throw new AppError(
        ERROR_CODES.IMPORT_FILE_INVALID,
        'Contenu actif (HTML/script) détecté dans le fichier.',
        'file',
      );
    }
  }
}

/**
 * Neutralise l'injection de formule dans un tableur (`=`, `+`, `-`, `@` en
 * tête de cellule). La valeur brute reste consultable, mais elle ne peut pas
 * être ré-exécutée par un tableur si l'utilisateur réexporte ses données.
 */
export function neutralizeFormula(cell: string): string {
  return /^[=+@\t\r]/.test(cell) ? `'${cell}` : cell;
}
