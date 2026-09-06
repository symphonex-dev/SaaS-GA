import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getServerEnv, resetServerEnvCache } from '@/lib/env/server';
import {
  consumeRateLimit,
  getRateLimitRule,
  setRateLimitStoreForTests,
} from '@/lib/security/rate-limit';
import { rateLimitRepository } from '@/server/repositories/rate-limit.repository';
import { importPreviewRepository } from '@/server/repositories/import-preview.repository';
import {
  consumePreview,
  createPreviewId,
  getPreview,
  resetPreviewStore,
  setPreviewStoreForTests,
  storePreview,
} from '@/server/import/preview-store';

import { resetDatabase, tables } from '../helpers/prisma-mock';

/**
 * Magasins partagés entre instances (CLAUDE.md §10.11).
 *
 * Ces tests exercent le **vrai** chemin PostgreSQL : les repositories, le
 * client Prisma (doublé) et l'énoncé SQL d'incrément atomique. Ils ne
 * remplacent pas une exécution contre un PostgreSQL réel — la contrainte de clé
 * primaire et le `ON CONFLICT` restent à vérifier avec `prisma migrate deploy`.
 */
const previousEnv = { ...process.env };

function usePostgresStores(): void {
  process.env['IMPORT_PREVIEW_STORE'] = 'postgres';
  process.env['RATE_LIMIT_STORE'] = 'postgres';
  resetServerEnvCache();
}

beforeEach(() => {
  resetDatabase();
  resetPreviewStore();
  setPreviewStoreForTests(null);
  setRateLimitStoreForTests(null);
  process.env = { ...previousEnv };
  resetServerEnvCache();
});

afterEach(() => {
  process.env = { ...previousEnv };
  resetServerEnvCache();
  setPreviewStoreForTests(null);
  setRateLimitStoreForTests(null);
});

function previewPayload(userId: string, importId: string) {
  return {
    importId,
    userId,
    sourceType: 'CSV' as const,
    filename: 'releve.csv',
    rows: [
      {
        rowNumber: 1,
        status: 'VALID' as const,
        raw: { date: '2026-01-05', libelle: 'NETFLIX', montant: '13,49' },
        errors: [],
      },
    ],
    mapping: null,
    headers: ['date', 'libelle', 'montant'],
    rawCells: [['2026-01-05', 'NETFLIX', '13,49']],
    rawLines: null,
    rowNumbers: [1],
    dateOrder: 'DMY' as const,
    defaultCurrency: 'EUR' as const,
    country: 'FR',
  };
}

describe('aperçu d’import — magasin PostgreSQL', () => {
  beforeEach(() => {
    usePostgresStores();
  });

  it('persiste l’aperçu en base plutôt qu’en mémoire du process', async () => {
    const importId = createPreviewId();

    await storePreview(previewPayload('usr_1', importId));

    expect(tables.importPreview.rows).toHaveLength(1);
    expect(tables.importPreview.rows[0]?.['userId']).toBe('usr_1');
  });

  it('relit l’aperçu écrit par une autre instance', async () => {
    const importId = createPreviewId();

    await storePreview(previewPayload('usr_1', importId));

    // Le magasin en mémoire est vidé : seule la base peut encore répondre.
    resetPreviewStore();

    const found = await getPreview(importId, 'usr_1');

    expect(found?.importId).toBe(importId);
    expect(found?.rawCells).toEqual([['2026-01-05', 'NETFLIX', '13,49']]);
    expect(found?.defaultCurrency).toBe('EUR');
  });

  it('traite l’aperçu d’un autre compte comme inexistant', async () => {
    const importId = createPreviewId();

    await storePreview(previewPayload('usr_1', importId));

    expect(await getPreview(importId, 'usr_2')).toBeNull();
  });

  it('refuse un aperçu expiré et ne le relit jamais', async () => {
    const importId = createPreviewId();
    const created = new Date('2026-01-05T10:00:00.000Z');

    await storePreview(previewPayload('usr_1', importId), created);

    const ttlMinutes = getServerEnv().IMPORT_PREVIEW_TTL_MINUTES;
    const afterTtl = new Date(created.getTime() + (ttlMinutes + 1) * 60_000);

    expect(await getPreview(importId, 'usr_1', afterTtl)).toBeNull();
  });

  it('purge les aperçus échus : aucune donnée de relevé ne survit au TTL', async () => {
    const importId = createPreviewId();
    const created = new Date('2026-01-05T10:00:00.000Z');

    await storePreview(previewPayload('usr_1', importId), created);

    const purged = await importPreviewRepository.purgeExpired(
      new Date(created.getTime() + 24 * 60 * 60_000),
    );

    expect(purged).toBe(1);
    expect(tables.importPreview.rows).toHaveLength(0);
  });

  it('ne se consomme qu’une seule fois, même en concurrence', async () => {
    const importId = createPreviewId();

    await storePreview(previewPayload('usr_1', importId));

    const outcomes = await Promise.all([
      consumePreview(importId, 'usr_1'),
      consumePreview(importId, 'usr_1'),
      consumePreview(importId, 'usr_1'),
    ]);

    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });

  it('n’est plus lisible après consommation', async () => {
    const importId = createPreviewId();

    await storePreview(previewPayload('usr_1', importId));
    await consumePreview(importId, 'usr_1');

    expect(await getPreview(importId, 'usr_1')).toBeNull();
  });

  it('ne laisse pas un autre compte consommer l’aperçu', async () => {
    const importId = createPreviewId();

    await storePreview(previewPayload('usr_1', importId));

    expect(await consumePreview(importId, 'usr_2')).toBe(false);
    expect(await getPreview(importId, 'usr_1')).not.toBeNull();
  });

  it('ignore une charge illisible plutôt que d’importer n’importe quoi', async () => {
    await importPreviewRepository.create({
      id: 'imp_corrompu',
      userId: 'usr_1',
      payload: { rows: 'pas un tableau' },
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(await getPreview('imp_corrompu', 'usr_1')).toBeNull();
  });
});

describe('rate limiting — compteur PostgreSQL', () => {
  beforeEach(() => {
    usePostgresStores();
  });

  it('écrit le compteur en base, partagé par toutes les instances', async () => {
    await consumeRateLimit('auth:login', '10.0.0.1');

    expect(tables.rateLimitCounter.rows).toHaveLength(1);
    expect(tables.rateLimitCounter.rows[0]?.['count']).toBe(1);
  });

  it('incrémente la même ligne d’un appel à l’autre', async () => {
    await consumeRateLimit('auth:login', '10.0.0.1');
    await consumeRateLimit('auth:login', '10.0.0.1');
    await consumeRateLimit('auth:login', '10.0.0.1');

    expect(tables.rateLimitCounter.rows).toHaveLength(1);
    expect(tables.rateLimitCounter.rows[0]?.['count']).toBe(3);
  });

  it('bloque à la limite, quel que soit le nombre d’instances', async () => {
    const { limit } = getRateLimitRule('auth:login');

    const results = await Promise.all(
      Array.from({ length: limit + 5 }, () => consumeRateLimit('auth:login', '10.0.0.2')),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(limit);
  });

  it('ouvre une ligne distincte à chaque fenêtre', async () => {
    const rule = getRateLimitRule('auth:login');
    const start = 10 * rule.windowMs;

    await consumeRateLimit('auth:login', '10.0.0.3', start);
    await consumeRateLimit('auth:login', '10.0.0.3', start + rule.windowMs);

    expect(tables.rateLimitCounter.rows).toHaveLength(2);
  });

  it('purge les fenêtres échues', async () => {
    const rule = getRateLimitRule('auth:login');
    const start = 10 * rule.windowMs;

    await consumeRateLimit('auth:login', '10.0.0.4', start);

    const purged = await rateLimitRepository.purgeExpired(new Date(start + rule.windowMs + 1));

    expect(purged).toBe(1);
    expect(tables.rateLimitCounter.rows).toHaveLength(0);
  });
});

describe('par défaut, le magasin reste en mémoire hors production', () => {
  it('n’écrit rien en base quand `RATE_LIMIT_STORE` vaut `memory`', async () => {
    process.env['RATE_LIMIT_STORE'] = 'memory';
    resetServerEnvCache();

    await consumeRateLimit('auth:login', '10.0.0.5');

    expect(tables.rateLimitCounter.rows).toHaveLength(0);
  });

  it('n’écrit rien en base quand `IMPORT_PREVIEW_STORE` vaut `memory`', async () => {
    process.env['IMPORT_PREVIEW_STORE'] = 'memory';
    resetServerEnvCache();

    const importId = createPreviewId();

    await storePreview(previewPayload('usr_1', importId));

    expect(tables.importPreview.rows).toHaveLength(0);
    expect(await getPreview(importId, 'usr_1')).not.toBeNull();
  });
});
