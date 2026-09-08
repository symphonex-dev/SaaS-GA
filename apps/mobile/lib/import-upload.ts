import type { ImportSource } from './import-state';

/**
 * Préparation de l'envoi d'un relevé (`specs/import-releves.md` §10).
 *
 * Le fichier part **tel quel** : son contenu n'est jamais lu, parsé ni compté
 * sur l'appareil (CLAUDE.md §5.1 et §5.4). Le serveur analyse puis supprime
 * immédiatement le fichier source.
 *
 * Ce module ne contient que des fonctions **pures** : il ne touche ni au
 * réseau ni au système de fichiers, ce qui le rend testable sans appareil.
 * L'envoi lui-même vit dans `lib/api-client.ts`, seul point de sortie HTTP de
 * l'application (`specs/ui-composants-mobile.md` §1).
 */
export interface ImportUploadFile {
  /** URI locale renvoyée par `expo-document-picker` (`file://…`). */
  uri: string;
  name: string;
  mimeType: string;
  source: ImportSource;
}

export interface ImportUploadOptions {
  delimiter?: string | undefined;
  dateOrder?: 'DMY' | 'MDY' | undefined;
  mapping?: { dateColumn: number; descriptionColumn: number; amountColumn: number } | undefined;
}

/** Types MIME acceptés pour un relevé CSV (`specs/import-releves.md` §4.1). */
export const CSV_MIME_TYPES = [
  'text/csv',
  'text/comma-separated-values',
  'text/plain',
  'application/vnd.ms-excel',
] as const;

export const PDF_MIME_TYPE = 'application/pdf';

/**
 * Type MIME à envoyer quand le sélecteur n'en fournit aucun.
 *
 * Certains fournisseurs de documents Android renvoient `mimeType: undefined`.
 * Le serveur revalide de toute façon le contenu réel : cette valeur n'est
 * qu'un défaut de transport, jamais une affirmation sur le fichier.
 */
export function resolveMimeType(mimeType: string | null | undefined, source: ImportSource): string {
  if (typeof mimeType === 'string' && mimeType.trim().length > 0) {
    return mimeType.trim();
  }

  return source === 'PDF' ? PDF_MIME_TYPE : 'text/csv';
}

/** Extension attendue par le contrôle serveur (`resolveSourceType`). */
const SOURCE_EXTENSION: Readonly<Record<ImportSource, string>> = {
  CSV: '.csv',
  PDF: '.pdf',
};

/**
 * Accents combinants produits par la décomposition NFD (U+0300 à U+036F).
 *
 * La plage est construite depuis une chaîne ASCII : écrite directement dans
 * un littéral d'expression régulière, elle déposerait de vrais caractères
 * combinants dans le fichier source, qui se collent au crochet ouvrant et
 * survivent mal aux outils qui renormalisent le texte.
 */
const COMBINING_MARKS = new RegExp('[\u0300-\u036f]', 'g');

/** Repli quand le nom d'origine ne laisse aucun caractère exploitable. */
const DEFAULT_UPLOAD_BASE_NAME = 'statement';

/** Un nom de fichier n'a pas à être long : il n'est qu'informatif côté serveur. */
const MAX_UPLOAD_BASE_LENGTH = 64;

/**
 * Nom sous lequel le relevé est déposé puis envoyé.
 *
 * Trois contraintes se cumulent, et aucune n'est décorative :
 *
 * 1. **L'extension fait foi côté serveur.** `resolveSourceType`
 *    (`apps/api/src/lib/import/file-guard.ts`) déduit CSV ou PDF de
 *    l'extension, puis exige que le contenu réel concorde. Or la copie que
 *    `expo-document-picker` dépose dans le cache est nommée `<uuid>pdf`, sans
 *    point : le serveur y lit « aucune extension » et rejette le fichier. Le
 *    nom est donc reconstruit à partir de la nature choisie par l'utilisateur.
 * 2. **Le nom doit être un nom de fichier, pas un chemin.** Il devient un
 *    fichier réel dans le cache de l'application : séparateurs et caractères
 *    de contrôle sont retirés, aucune remontée de répertoire n'est possible.
 * 3. **Les accents sont repliés sur leur équivalent ASCII.** Ce nom voyage
 *    dans l'en-tête `Content-Disposition` du corps multipart ; le limiter à
 *    l'ASCII imprimable évite d'avoir à parier sur l'encodage retenu par
 *    chaque couche traversée. Le nom reste lisible (« Relevé » → « Releve »)
 *    et il n'est de toute façon jamais utilisé pour construire un chemin
 *    serveur.
 */
export function importUploadFileName(name: string, source: ImportSource): string {
  const base = name
    // Extension d'origine retirée : c'est `source` qui tranche, pas le nom.
    .replace(/\.[^.]*$/, '')
    // « é » → « e » + accent combinant, puis retrait des accents combinants.
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^A-Za-z0-9 ._-]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_UPLOAD_BASE_LENGTH)
    // Ni point ni espace en tête : un fichier caché ou un « .. » résiduel.
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');

  return `${base.length > 0 ? base : DEFAULT_UPLOAD_BASE_NAME}${SOURCE_EXTENSION[source]}`;
}

/**
 * Champs de formulaire accompagnant le fichier.
 *
 * Ils ne sont envoyés que lorsque le serveur a refusé de deviner : séparateur
 * confirmé (§4.2), correspondance de colonnes (§4.4), ordre des dates (§4.6).
 * Aucun autre champ n'a le droit d'exister ici — en particulier rien qui
 * ressemble à un statut, une source ou un identifiant : c'est le serveur qui
 * les fixe.
 */
export function buildImportUploadParameters(
  options: ImportUploadOptions = {},
): Record<string, string> {
  const parameters: Record<string, string> = {};

  if (options.delimiter !== undefined) {
    parameters['delimiter'] = options.delimiter;
  }

  if (options.dateOrder !== undefined) {
    parameters['dateOrder'] = options.dateOrder;
  }

  if (options.mapping !== undefined) {
    parameters['mapping'] = JSON.stringify(options.mapping);
  }

  return parameters;
}
