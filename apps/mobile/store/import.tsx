import type { ImportConfirmResultDto, ImportPreviewDto } from '@subscription-manager/shared';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import {
  previewState,
  type ImportSource,
  type ImportState,
  type PickedFile,
} from '../lib/import-state';

/**
 * État du parcours d'import (`specs/ui-composants-mobile.md` §4 et §14).
 *
 * Il ne contient que ce que le serveur a renvoyé et l'arbitrage de
 * l'utilisateur (lignes incluses/exclues). **Aucun total, aucun doublon,
 * aucun score n'est recalculé ici** : tout vient du DTO d'aperçu.
 *
 * La machine à états et ses transitions dérivées vivent dans
 * `lib/import-state.ts` — logique pure, donc testable sans moteur de rendu.
 */
export {
  IMPORT_STATE_LABEL_KEYS,
  acceptedRowNumbers,
  previewState,
  type ImportSource,
  type ImportState,
  type PickedFile,
} from '../lib/import-state';

interface ImportContextValue {
  state: ImportState;
  source: ImportSource | null;
  file: PickedFile | null;
  preview: ImportPreviewDto | null;
  result: ImportConfirmResultDto | null;
  /** Numéros de ligne que l'utilisateur a explicitement exclus. */
  excludedRows: ReadonlySet<number>;
  setState: (state: ImportState) => void;
  setSource: (source: ImportSource) => void;
  setFile: (file: PickedFile | null) => void;
  setPreview: (preview: ImportPreviewDto | null) => void;
  setResult: (result: ImportConfirmResultDto | null) => void;
  toggleRow: (rowNumber: number) => void;
  reset: () => void;
}

const ImportContext = createContext<ImportContextValue | null>(null);

export function ImportProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<ImportState>('idle');
  const [source, setSourceValue] = useState<ImportSource | null>(null);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [preview, setPreviewValue] = useState<ImportPreviewDto | null>(null);
  const [result, setResult] = useState<ImportConfirmResultDto | null>(null);
  const [excludedRows, setExcludedRows] = useState<ReadonlySet<number>>(new Set());

  const setSource = useCallback((next: ImportSource) => {
    setSourceValue(next);
    setState('idle');
  }, []);

  const setPreview = useCallback((next: ImportPreviewDto | null) => {
    setPreviewValue(next);

    const cleared = new Set<number>();

    setExcludedRows(cleared);

    if (next === null) {
      setState('idle');

      return;
    }

    setState(previewState(next, cleared));
  }, []);

  const toggleRow = useCallback(
    (rowNumber: number) => {
      setExcludedRows((current) => {
        const next = new Set(current);

        if (next.has(rowNumber)) {
          next.delete(rowNumber);
        } else {
          next.add(rowNumber);
        }

        // Exclure la dernière ligne retenue ramène le lot à « rien à importer ».
        if (preview !== null) {
          setState(previewState(preview, next));
        }

        return next;
      });
    },
    [preview],
  );

  const reset = useCallback(() => {
    setState('idle');
    setSourceValue(null);
    setFile(null);
    setPreviewValue(null);
    setResult(null);
    setExcludedRows(new Set());
  }, []);

  const value = useMemo<ImportContextValue>(
    () => ({
      state,
      source,
      file,
      preview,
      result,
      excludedRows,
      setState,
      setSource,
      setFile,
      setPreview,
      setResult,
      toggleRow,
      reset,
    }),
    [state, source, file, preview, result, excludedRows, setSource, setPreview, toggleRow, reset],
  );

  return <ImportContext.Provider value={value}>{children}</ImportContext.Provider>;
}

export function useImportFlow(): ImportContextValue {
  const context = useContext(ImportContext);

  if (context === null) {
    throw new Error('useImportFlow doit être utilisé dans un ImportProvider.');
  }

  return context;
}
