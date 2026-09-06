import type { ImportPreviewDto } from '@subscription-manager/shared';

/**
 * Machine à états du parcours d'import (`specs/ui-composants-mobile.md` §14).
 *
 * Logique pure, séparée du fournisseur React (`store/import.tsx`) pour être
 * testable sans moteur de rendu. Elle ne calcule **aucun** total : les statuts
 * de ligne, les doublons et les compteurs viennent du DTO d'aperçu produit par
 * le serveur (CLAUDE.md §5.1).
 *
 * ```
 * idle            fichier pas encore choisi
 *   → uploading         envoi du fichier vers POST /api/imports/preview
 *   → parsing           réanalyse serveur avec une correspondance de colonnes
 *   → preview           aperçu reçu, aucune ligne retenue
 *   → validation_error  aperçu avec des lignes illisibles, ou confirmation en échec
 *   → ready_to_import   au moins une ligne insérable et retenue
 *   → importing         POST /api/imports/confirm en cours
 *   → completed         lot enregistré
 *   → rollback_available lot enregistré et encore annulable
 * ```
 */
export type ImportState =
  | 'idle'
  | 'uploading'
  | 'parsing'
  | 'preview'
  | 'validation_error'
  | 'ready_to_import'
  | 'importing'
  | 'completed'
  | 'rollback_available';

export type ImportSource = 'CSV' | 'PDF';

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
}

/**
 * Libellé traduit de chaque état.
 *
 * La table est exhaustive par construction (`Record<ImportState, …>`) : ajouter
 * un état sans son libellé ne compile pas. Sans elle, une interpolation directe
 * du nom d'état afficherait la clé technique à l'utilisateur (§13 : aucune
 * chaîne technique n'est jamais affichée telle quelle).
 */
export const IMPORT_STATE_LABEL_KEYS: Readonly<Record<ImportState, string>> = {
  idle: 'import.states.idle',
  uploading: 'import.states.uploading',
  parsing: 'import.states.parsing',
  preview: 'import.states.preview',
  validation_error: 'import.states.validationError',
  ready_to_import: 'import.states.readyToImport',
  importing: 'import.states.importing',
  completed: 'import.states.completed',
  rollback_available: 'import.states.rollbackAvailable',
};

/**
 * Lignes que le serveur juge insérables et que l'utilisateur n'a pas exclues.
 *
 * Le statut vient du serveur ; ce filtre ne fait que retirer les exclusions
 * décidées par l'utilisateur. Un doublon de confiance haute n'est jamais
 * retenu, même non exclu : la décision reste serveur
 * (`specs/import-releves.md` §8). Le serveur revalide tout à la confirmation.
 */
export function acceptedRowNumbers(
  preview: ImportPreviewDto,
  excluded: ReadonlySet<number>,
): number[] {
  const mediumDuplicates = new Set(
    preview.duplicates
      .filter((candidate) => candidate.confidence === 'MEDIUM')
      .map((candidate) => candidate.importedRowNumber),
  );

  return preview.rows
    .filter((row) => row.status === 'VALID' || mediumDuplicates.has(row.rowNumber))
    .map((row) => row.rowNumber)
    .filter((rowNumber) => !excluded.has(rowNumber));
}

/**
 * État dérivé d'un aperçu et des exclusions courantes.
 *
 * Une ligne illisible n'est jamais insérée silencieusement : l'écran de revue
 * signale l'état avant toute confirmation. Une fois qu'au moins une ligne reste
 * retenue, le lot est prêt à être importé.
 */
export function previewState(
  preview: ImportPreviewDto,
  excluded: ReadonlySet<number>,
): Extract<ImportState, 'preview' | 'validation_error' | 'ready_to_import'> {
  if (preview.counts.invalid > 0) {
    return 'validation_error';
  }

  return acceptedRowNumbers(preview, excluded).length > 0 ? 'ready_to_import' : 'preview';
}
