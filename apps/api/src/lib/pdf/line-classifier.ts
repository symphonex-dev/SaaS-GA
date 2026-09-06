import type { DateOrder, PdfExtractedLine } from '@subscription-manager/shared';

import { parseMoney, type DecimalSeparatorHint } from '@/lib/csv/amount';
import { parseCsvDate } from '@/lib/csv/date';

import { computeLineConfidence } from './confidence';

/**
 * Classification des lignes extraites d'un PDF (`specs/import-releves.md` §5).
 *
 * Une ligne de relevé se reconnaît à trois composantes : une date, un montant,
 * et un libellé entre les deux. La classification est déterministe et ne
 * suppose aucune mise en page particulière — seulement une structure lisible,
 * ce que le message de compatibilité annonce explicitement à l'utilisateur.
 */

/** Date en tête de ligne, dans les formats numériques ou ISO courants. */
const LEADING_DATE = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:\d{2}|\d{4}))\b/;

/**
 * Montant en fin de ligne : signe optionnel, séparateurs de milliers, deux
 * décimales. Les relevés placent le montant en dernière colonne.
 */
const TRAILING_AMOUNT =
  /(-|\()?\s*\d{1,3}(?:[\s\u00A0\u202F.,]\d{3})*(?:[.,]\d{2})\s*(?:\)|-)?\s*(?:€|EUR|\$|USD|£|GBP)?$/i;

/** Un solde de fin de ligne n'est pas une transaction. */
const BALANCE_MARKERS = /\b(?:solde|balance|saldo|total|report|nouveau solde)\b/i;

export interface ClassifyOptions {
  dateOrder: DateOrder;
  decimalHint: DecimalSeparatorHint;
}

export function classifyPdfLine(rawText: string, options: ClassifyOptions): PdfExtractedLine {
  const line = rawText.replace(/\s+/g, ' ').trim();

  const dateMatch = LEADING_DATE.exec(line);
  const rest = dateMatch === null ? line : line.slice(dateMatch[0].length).trim();
  const amountMatch = TRAILING_AMOUNT.exec(rest);

  const parsedDate = dateMatch === null ? null : toIsoOrNull(dateMatch[0], options.dateOrder);

  const parsedAmountRaw = amountMatch === null ? null : amountMatch[0].trim();
  const parsedMoney =
    parsedAmountRaw === null ? null : parseMoney(parsedAmountRaw, options.decimalHint);

  const description =
    amountMatch === null
      ? rest
      : rest
          .slice(0, amountMatch.index)
          .replace(/[.\s|-]+$/, '')
          .trim();

  const parsedDescription = description.length === 0 ? null : description;

  // Un montant signé négativement doit rester distinguable d'un crédit : le
  // signe est reporté dans la valeur, le pipeline le réinterprète ensuite.
  const parsedAmount =
    parsedMoney === null
      ? null
      : parsedMoney.sign === 'negative'
        ? `-${parsedMoney.value}`
        : parsedMoney.value;

  const isBalanceLine = BALANCE_MARKERS.test(line);

  return {
    rawText: line,
    parsedDate,
    parsedAmount,
    parsedDescription,
    confidence: computeLineConfidence({
      hasDate: parsedDate !== null,
      hasAmount: parsedAmount !== null,
      description: parsedDescription,
      isBalanceLine,
    }),
  };
}

function toIsoOrNull(value: string, dateOrder: DateOrder): string | null {
  const result = parseCsvDate(value, dateOrder);

  return result.ok ? result.date.iso : null;
}

/**
 * Une ligne d'en-tête, de pied de page ou de solde n'est pas une transaction
 * candidate : elle est écartée avant classification pour ne pas gonfler
 * artificiellement le nombre de lignes en échec.
 */
export function isTransactionCandidate(line: string): boolean {
  if (BALANCE_MARKERS.test(line) && !LEADING_DATE.test(line)) {
    return false;
  }

  // Une ligne sans le moindre chiffre ne peut porter ni date ni montant.
  return /\d/.test(line);
}
