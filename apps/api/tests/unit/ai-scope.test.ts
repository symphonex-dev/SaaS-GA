import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AI_TASKS } from '@subscription-manager/shared';
import { describe, expect, it } from 'vitest';

/**
 * Périmètre de l'IA, vérifié sur le code lui-même
 * (`specs/comparateur-et-assistant-ia.md` B.2 et checklist B.9 : « aucun des
 * usages hors-périmètre n'est accessible via une route ou un composant »).
 *
 * Ces assertions sont structurelles : elles échouent si quelqu'un ajoute une
 * quatrième tâche, une quatrième route IA, ou expose la clé au client.
 */
// Chemins derives du fichier de test, jamais du repertoire courant : la suite
// doit se comporter pareil lancee depuis la racine ou depuis `apps/api`.
const API_SRC = fileURLToPath(new URL('../../src', import.meta.url));
const API_ROOT = join(API_SRC, 'app', 'api');
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('périmètre de l’assistant IA', () => {
  it('ne déclare que trois usages', () => {
    expect([...AI_TASKS]).toEqual(['MONTHLY_SUMMARY', 'EXPLAIN_INCREASE', 'RECOMMENDATION']);
  });

  it('n’expose que trois routes sous /api/ai', () => {
    const routes = readdirSync(join(API_ROOT, 'ai')).sort();

    expect(routes).toEqual(['explain-increase', 'recommendation', 'summary']);
  });

  it('n’expose aucune route de conversation, de prédiction ou de catégorisation', () => {
    const paths = filesUnder(API_ROOT).map((path) => path.toLowerCase());
    const interdits = ['chat', 'conversation', 'assistant/ask', 'predict', 'categorize', 'advice'];

    for (const interdit of interdits) {
      expect(paths.some((path) => path.includes(interdit))).toBe(false);
    }
  });

  it('n’expose jamais la clé IA au bundle mobile (B.4)', () => {
    const mobileFiles = filesUnder(join(REPO_ROOT, 'apps', 'mobile', 'lib')).filter((path) =>
      path.endsWith('.ts'),
    );

    for (const path of [...mobileFiles, join(REPO_ROOT, '.env.example')]) {
      const content = readFileSync(path, 'utf8');

      expect(content).not.toContain('NEXT_PUBLIC_AI_API_KEY');
      expect(content).not.toContain('EXPO_PUBLIC_AI_API_KEY');
    }
  });

  it('ne lit la clé IA que dans le provider serveur', () => {
    const readers = filesUnder(API_SRC)
      .filter((path) => path.endsWith('.ts'))
      .filter((path) => readFileSync(path, 'utf8').includes('AI_API_KEY'));

    // `ai.provider.ts` teste seulement la **présence** de la clé pour décider
    // si le provider est utilisable ; seule la couche OpenAI lit sa valeur.
    expect(readers.map((path) => path.replace(/\\/g, '/').split('/src/')[1])).toEqual([
      'lib/env/server.ts',
      'server/ai/ai.provider.ts',
      'server/ai/providers/openai.provider.ts',
    ]);
  });

  it('ne transporte la clé IA dans aucun paquet partagé avec le mobile', () => {
    const sharedFiles = filesUnder(join(REPO_ROOT, 'packages', 'shared')).filter((path) =>
      path.endsWith('.ts'),
    );

    for (const path of sharedFiles) {
      expect(readFileSync(path, 'utf8')).not.toContain('AI_API_KEY');
    }
  });

  it('n’utilise l’IA pour aucune traduction (CLAUDE.md §5.6)', () => {
    const aiFiles = filesUnder(join(API_SRC, 'server', 'ai'));
    const prompt = aiFiles
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
      .toLowerCase();

    // La seule occurrence tolérée est l'interdiction elle-même.
    expect(prompt).toContain('never translate');
  });
});
