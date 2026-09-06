/**
 * Construction du corps multipart d'un import (`specs/import-releves.md` §10).
 *
 * Le fichier part **tel quel** : aucune lecture, aucun parsing, aucun comptage
 * n'a lieu sur l'appareil (CLAUDE.md §5.1 et §5.4). Le serveur analyse puis
 * supprime immédiatement le fichier source.
 *
 * Fonction pure et sans dépendance React Native, donc testable : elle ne
 * manipule que `FormData` et des chaînes.
 */
export interface ImportUploadFile {
  /** URI locale renvoyée par `expo-document-picker` (`file://…`). */
  uri: string;
  name: string;
  mimeType: string;
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
export function resolveMimeType(
  mimeType: string | null | undefined,
  source: 'CSV' | 'PDF',
): string {
  if (typeof mimeType === 'string' && mimeType.trim().length > 0) {
    return mimeType.trim();
  }

  return source === 'PDF' ? PDF_MIME_TYPE : 'text/csv';
}

/**
 * Corps multipart de `POST /api/imports/preview`.
 *
 * React Native accepte `{ uri, name, type }` comme entrée fichier de
 * `FormData` : c'est le moteur natif qui lit l'URI au moment de l'envoi.
 */
export function buildImportFormData(
  file: ImportUploadFile,
  options: ImportUploadOptions = {},
  /**
   * Instance à remplir. Injectable pour les tests : l'implémentation de
   * `FormData` de React Native conserve l'objet `{ uri, name, type }` tel quel,
   * là où celle de Node le convertirait en chaîne.
   */
  form: FormData = new FormData(),
): FormData {
  form.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);

  if (options.delimiter !== undefined) {
    form.append('delimiter', options.delimiter);
  }

  if (options.dateOrder !== undefined) {
    form.append('dateOrder', options.dateOrder);
  }

  if (options.mapping !== undefined) {
    form.append('mapping', JSON.stringify(options.mapping));
  }

  return form;
}
