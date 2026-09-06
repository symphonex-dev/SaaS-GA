import type { CsvDelimiter } from '@subscription-manager/shared';

/**
 * Parser CSV conforme à la logique RFC 4180 (`specs/import-releves.md` §4.3).
 *
 * Automate à états, jamais `line.split(delimiter)` : les champs quotés, les
 * guillemets échappés (`""`), les séparateurs et les retours à la ligne à
 * l'intérieur d'un champ doivent être préservés.
 */
export interface CsvParseResult {
  rows: string[][];
  /** `true` si le fichier se termine sur un champ quoté non refermé. */
  unterminatedQuote: boolean;
}

export function parseCsv(text: string, delimiter: CsvDelimiter): CsvParseResult {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;
  let index = 0;

  const pushField = (): void => {
    // Un champ quoté conserve ses espaces ; un champ nu est nettoyé de ses
    // espaces de bordure, systématiquement présents dans les exports bancaires.
    row.push(fieldWasQuoted ? field : field.trim());
    field = '';
    fieldWasQuoted = false;
  };

  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const character = text[index] ?? '';

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          // Guillemet échappé à l'intérieur d'un champ quoté.
          field += '"';
          index += 2;
          continue;
        }

        inQuotes = false;
        index += 1;
        continue;
      }

      field += character;
      index += 1;
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
      fieldWasQuoted = true;
      index += 1;
      continue;
    }

    if (character === delimiter) {
      pushField();
      index += 1;
      continue;
    }

    if (character === '\r') {
      // CRLF comme LF seul : une seule fin de ligne logique.
      if (text[index + 1] === '\n') {
        index += 1;
      }

      pushRow();
      index += 1;
      continue;
    }

    if (character === '\n') {
      pushRow();
      index += 1;
      continue;
    }

    field += character;
    index += 1;
  }

  // Dernière ligne sans saut final.
  if (field.length > 0 || row.length > 0 || fieldWasQuoted) {
    pushRow();
  }

  return { rows: dropTrailingEmptyRows(rows), unterminatedQuote: inQuotes };
}

/** Les exports bancaires se terminent souvent par une ou plusieurs lignes vides. */
function dropTrailingEmptyRows(rows: string[][]): string[][] {
  const result = [...rows];

  while (result.length > 0 && isEmptyRow(result[result.length - 1])) {
    result.pop();
  }

  return result;
}

export function isEmptyRow(row: string[] | undefined): boolean {
  return row === undefined || row.every((cell) => cell.trim().length === 0);
}
