import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Hygiène des journaux (CLAUDE.md §6 : aucune donnée sensible dans les logs).
 *
 * Le test lit le code réel : il échoue si quelqu'un ajoute un journal qui
 * interpole un secret, un jeton, une adresse ou un montant. C'est une barrière
 * grossière mais efficace — les fuites de logs viennent presque toujours d'une
 * interpolation ajoutée « pour déboguer ».
 */
const API_SRC = path.resolve(__dirname, '../../src');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      sourceFiles(full, acc);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      acc.push(full);
    }
  }

  return acc;
}

/** Extrait chaque appel `console.*`, avec son fichier et sa ligne. */
function consoleCalls(): { file: string; line: number; text: string }[] {
  const calls: { file: string; line: number; text: string }[] = [];

  for (const file of sourceFiles(API_SRC)) {
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');

    lines.forEach((line, index) => {
      if (!/\bconsole\.(log|info|warn|error|debug|trace)\s*\(/.test(line)) {
        return;
      }

      // L'appel peut tenir sur plusieurs lignes : on prend la fenêtre suivante.
      const text = lines.slice(index, index + 8).join('\n');

      calls.push({ file: path.relative(API_SRC, file), line: index + 1, text });
    });
  }

  return calls;
}

/**
 * Identifiants dont l'interpolation dans un journal serait une fuite.
 *
 * `resetUrl` est toléré dans le seul transport `console`, qui est refusé en
 * production (`mailer.ts`) : c'est précisément sa raison d'être en local.
 */
const FORBIDDEN_IN_LOGS = [
  'passwordHash',
  'tokenHash',
  'purchaseToken',
  'transactionId',
  'API_KEY',
  'PRIVATE_KEY',
  'SERVICE_ACCOUNT',
  'CRON_SECRET',
  'VERIFICATION_TOKEN',
  'signedPayload',
  'user.email',
  'input.password',
];

describe('aucune donnée sensible dans les journaux', () => {
  it('recense bien des appels à journaliser (le test ne passe pas à vide)', () => {
    expect(consoleCalls().length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN_IN_LOGS)('n’interpole jamais %s', (identifier) => {
    const offenders = consoleCalls()
      .filter((call) => call.text.includes(identifier))
      .map((call) => `${call.file}:${String(call.line)}`);

    expect(offenders).toEqual([]);
  });

  it('ne journalise le lien de réinitialisation que dans le transport de développement', () => {
    const offenders = consoleCalls()
      .filter((call) => call.text.includes('resetUrl'))
      .map((call) => call.file.replace(/\\/g, '/'));

    expect(offenders).toEqual(['lib/mail/mailer.ts']);
  });

  it('journalise les erreurs par leur nom, jamais par leur message', () => {
    // Un `error.message` peut contenir une valeur (adresse, URL, requête SQL) ;
    // `error.name` suffit à diagnostiquer et ne porte rien.
    const offenders = consoleCalls()
      .filter((call) => /console\.[a-z]+\([^)]*error\.message/s.test(call.text))
      .map((call) => `${call.file}:${String(call.line)}`);

    expect(offenders).toEqual([]);
  });

  it('n’écrit jamais le corps d’une requête ou d’une réponse', () => {
    const offenders = consoleCalls()
      .filter((call) => /console\.[a-z]+\([^)]*\b(body|payload|rawBody)\b/s.test(call.text))
      .map((call) => `${call.file}:${String(call.line)}`);

    expect(offenders).toEqual([]);
  });
});
