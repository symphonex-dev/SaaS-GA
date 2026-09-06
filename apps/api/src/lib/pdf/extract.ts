import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Extraction du texte d'un PDF (`specs/import-releves.md` §5).
 *
 * L'extraction se fait exclusivement côté serveur — jamais dans
 * `apps/mobile` (CLAUDE.md §2.3). La bibliothèque est isolée derrière ce
 * module : la remplacer n'impacte aucun autre fichier du pipeline.
 */
export interface PdfExtraction {
  pageCount: number;
  /** Texte par page, lignes séparées par des sauts de ligne. */
  pages: string[];
}

export class PdfExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfExtractionError';
  }
}

/** Signature d'un fichier PDF : les 5 premiers octets valent toujours `%PDF-`. */
export function hasPdfSignature(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * Un PDF chiffré, corrompu ou sans couche texte (relevé scanné) déclenche une
 * `PdfExtractionError` : le pipeline la traduit en `IMPORT_FILE_INVALID`,
 * jamais en résultat partiel silencieux.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtraction> {
  if (!hasPdfSignature(buffer)) {
    throw new PdfExtractionError('Signature PDF absente.');
  }

  try {
    const document = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(document, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];

    return { pageCount: document.numPages, pages };
  } catch (error) {
    throw new PdfExtractionError(
      error instanceof Error ? `Extraction impossible : ${error.name}` : 'Extraction impossible.',
    );
  }
}

/**
 * Découpe le texte extrait en lignes candidates.
 *
 * Les lignes vides et les lignes trop courtes pour porter une transaction sont
 * écartées ici : elles ne doivent pas peser sur le décompte des lignes en
 * échec présenté à l'utilisateur.
 */
export function toCandidateLines(pages: readonly string[]): string[] {
  return pages
    .flatMap((page) => page.split(/\r?\n/))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 8);
}
