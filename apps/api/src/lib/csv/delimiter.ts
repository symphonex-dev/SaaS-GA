import { CSV_DELIMITERS, type CsvDelimiter } from '@subscription-manager/shared';

/**
 * Détection du séparateur CSV (`specs/import-releves.md` §4.2).
 *
 * Principe : compter les séparateurs candidats **hors champs quotés** sur un
 * échantillon de lignes, et retenir celui qui produit un nombre de colonnes
 * cohérent (identique) d'une ligne à l'autre. En cas d'égalité entre deux
 * candidats plausibles, le résultat est marqué ambigu : le serveur demande
 * confirmation plutôt que de deviner.
 */
export interface DelimiterDetection {
  delimiter: CsvDelimiter;
  /** Nombre de colonnes obtenu avec ce séparateur sur l'échantillon. */
  columnCount: number;
  ambiguous: boolean;
  /** Candidats jugés également plausibles (présents seulement si ambigu). */
  candidates: CsvDelimiter[];
}

const SAMPLE_LINE_COUNT = 20;

interface CandidateScore {
  delimiter: CsvDelimiter;
  columnCount: number;
  /** Proportion de lignes de l'échantillon ayant ce nombre de colonnes. */
  consistency: number;
  totalOccurrences: number;
}

/**
 * Découpe le texte en lignes logiques, en ignorant les retours à la ligne
 * situés à l'intérieur d'un champ quoté.
 */
function sampleLogicalLines(text: string, limit: number): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < text.length && lines.length < limit; index += 1) {
    const character = text[index] ?? '';

    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        current += '""';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      current += character;
      continue;
    }

    if (!inQuotes && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }

      if (current.trim().length > 0) {
        lines.push(current);
      }

      current = '';
      continue;
    }

    current += character;
  }

  if (lines.length < limit && current.trim().length > 0) {
    lines.push(current);
  }

  return lines;
}

/** Compte les occurrences d'un séparateur hors champs quotés. */
export function countOutsideQuotes(line: string, delimiter: CsvDelimiter): number {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && character === delimiter) {
      count += 1;
    }
  }

  return count;
}

function scoreCandidate(lines: readonly string[], delimiter: CsvDelimiter): CandidateScore {
  const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
  const occurrences = counts.reduce((total, count) => total + count, 0);

  const frequency = new Map<number, number>();

  for (const count of counts) {
    if (count > 0) {
      frequency.set(count, (frequency.get(count) ?? 0) + 1);
    }
  }

  let bestCount = 0;
  let bestLines = 0;

  for (const [count, linesWithCount] of frequency) {
    // À égalité de lignes, on privilégie le plus grand nombre de colonnes :
    // un séparateur présent une fois par ligne par hasard perd contre celui
    // qui structure réellement le fichier.
    if (linesWithCount > bestLines || (linesWithCount === bestLines && count > bestCount)) {
      bestCount = count;
      bestLines = linesWithCount;
    }
  }

  return {
    delimiter,
    columnCount: bestCount === 0 ? 0 : bestCount + 1,
    consistency: lines.length === 0 ? 0 : bestLines / lines.length,
    totalOccurrences: occurrences,
  };
}

/**
 * Renvoie `null` si aucun séparateur ne structure le fichier : un CSV à une
 * seule colonne n'est pas exploitable pour un relevé bancaire.
 */
export function detectDelimiter(text: string): DelimiterDetection | null {
  const lines = sampleLogicalLines(text, SAMPLE_LINE_COUNT);

  if (lines.length === 0) {
    return null;
  }

  const scores = CSV_DELIMITERS.map((delimiter) => scoreCandidate(lines, delimiter))
    .filter((score) => score.columnCount >= 2)
    // Un séparateur retenu doit structurer la majorité des lignes.
    .filter((score) => score.consistency >= 0.5)
    .sort((left, right) => {
      if (right.consistency !== left.consistency) {
        return right.consistency - left.consistency;
      }

      return right.totalOccurrences - left.totalOccurrences;
    });

  const best = scores[0];

  if (best === undefined) {
    return null;
  }

  // Ambiguïté : un second candidat aussi cohérent et aussi présent.
  const ambiguousCandidates = scores.filter(
    (score) =>
      score.consistency === best.consistency && score.totalOccurrences === best.totalOccurrences,
  );

  return {
    delimiter: best.delimiter,
    columnCount: best.columnCount,
    ambiguous: ambiguousCandidates.length > 1,
    candidates: ambiguousCandidates.map((score) => score.delimiter),
  };
}
