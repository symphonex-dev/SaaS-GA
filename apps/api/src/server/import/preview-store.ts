import { randomBytes } from 'node:crypto';

import type {
  CsvColumnMapping,
  Currency,
  DateOrder,
  ImportSourceType,
  ParsedRow,
  PdfExtractedLine,
} from '@subscription-manager/shared';

import { getServerEnv } from '@/lib/env/server';
import { importPreviewRepository } from '@/server/repositories/import-preview.repository';

/**
 * Conservation de l'aperçu entre `POST /api/imports/preview` et
 * `POST /api/imports/confirm`.
 *
 * Le fichier source est supprimé dès la fin de l'aperçu
 * (`specs/import-releves.md` §3) : les lignes déjà analysées doivent donc être
 * conservées côté serveur, sans quoi la confirmation devrait faire confiance
 * aux données renvoyées par le client — ce que la spec §2 interdit
 * explicitement.
 *
 * ## Magasin
 *
 * `IMPORT_PREVIEW_STORE` choisit le support :
 *
 * - `postgres` — table `import_previews`, **obligatoire en production**
 *   (`src/instrumentation.ts`). Avec plusieurs instances, la confirmation
 *   n'atteint pas forcément le process qui a produit l'aperçu : en mémoire, elle
 *   échouerait une fois sur deux. La persistance survit aussi à un redémarrage
 *   et à un déploiement.
 * - `memory` — développement et tests, instance unique.
 *
 * ## Garanties, identiques quel que soit le support
 *
 * - **TTL** : `IMPORT_PREVIEW_TTL_MINUTES`. Un aperçu échu n'est jamais lu, et
 *   les lignes sont purgées — aucune donnée de relevé ne subsiste au-delà.
 * - **Propriété** : chaque accès filtre par `userId`. L'aperçu d'un autre compte
 *   est traité comme inexistant (CLAUDE.md §5.3).
 * - **Consommation unique** : une confirmation gagnante marque l'aperçu ; une
 *   seconde confirmation ne trouve plus rien, même concurrente.
 *
 * DÉVIATION ASSUMÉE : `specs/schema-donnees.md` §15 fixe une liste fermée de
 * tables, qui ne prévoit pas d'aperçu en attente. La table est technique et
 * documentée en CLAUDE.md §10.11.
 */
export interface StoredPreview {
  importId: string;
  /** Propriétaire de l'aperçu : vérifié à chaque accès (CLAUDE.md §5.3). */
  userId: string;
  sourceType: ImportSourceType;
  filename: string | null;
  /** Lignes analysées, dans l'ordre du fichier. */
  rows: ParsedRow[];
  mapping: CsvColumnMapping | null;
  headers: string[] | null;
  /**
   * Données brutes conservées pour permettre une ré-analyse à la confirmation
   * (changement de mapping, d'ordre de date, correction de lignes) alors que le
   * fichier source a déjà été supprimé.
   */
  rawCells: string[][] | null;
  rawLines: PdfExtractedLine[] | null;
  /** Numéro de ligne dans le fichier, aligné sur `rawCells` / `rawLines`. */
  rowNumbers: number[];
  dateOrder: DateOrder;
  defaultCurrency: Currency;
  country: string;
  createdAt: Date;
  expiresAt: Date;
}

/** Champs persistés : `createdAt` et `expiresAt` sont portés par la ligne. */
type PreviewPayload = Omit<StoredPreview, 'createdAt' | 'expiresAt'>;

export interface PreviewStore {
  save(preview: StoredPreview): Promise<void>;
  find(importId: string, userId: string, now: Date): Promise<StoredPreview | null>;
  /** `true` si cet appel a gagné la consommation ; `false` s'il arrive après. */
  consume(importId: string, userId: string, now: Date): Promise<boolean>;
}

/* -------------------------------------------------------------------------- */
/* Magasin en mémoire — développement et tests                                 */
/* -------------------------------------------------------------------------- */

function createMemoryPreviewStore(): PreviewStore & { clear: () => void } {
  const previews = new Map<string, StoredPreview>();

  return {
    save: (preview) => {
      for (const [id, candidate] of previews) {
        if (candidate.expiresAt <= preview.createdAt) {
          previews.delete(id);
        }
      }

      previews.set(preview.importId, preview);

      return Promise.resolve();
    },
    find: (importId, userId, now) => {
      const preview = previews.get(importId);

      if (preview === undefined) {
        return Promise.resolve(null);
      }

      if (preview.expiresAt <= now) {
        previews.delete(importId);

        return Promise.resolve(null);
      }

      // Aperçu d'un autre compte : traité comme inexistant, aucune information
      // ne fuite sur son existence.
      return Promise.resolve(preview.userId === userId ? preview : null);
    },
    consume: (importId, userId) => {
      const preview = previews.get(importId);

      if (preview === undefined || preview.userId !== userId) {
        return Promise.resolve(false);
      }

      previews.delete(importId);

      return Promise.resolve(true);
    },
    clear: () => {
      previews.clear();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Magasin PostgreSQL — production                                             */
/* -------------------------------------------------------------------------- */

/**
 * Revalide la charge relue en base.
 *
 * Elle a été écrite par ce même module, mais elle a traversé une sérialisation
 * JSON : les dates y sont des chaînes, et une ligne corrompue ou tronquée ne
 * doit pas produire un import silencieusement faux.
 */
function toStoredPreview(row: {
  id: string;
  userId: string;
  payload: unknown;
  createdAt: Date;
  expiresAt: Date;
}): StoredPreview | null {
  if (typeof row.payload !== 'object' || row.payload === null || Array.isArray(row.payload)) {
    return null;
  }

  const payload = row.payload as Partial<PreviewPayload>;

  if (
    !Array.isArray(payload.rows) ||
    !Array.isArray(payload.rowNumbers) ||
    typeof payload.sourceType !== 'string' ||
    typeof payload.dateOrder !== 'string' ||
    typeof payload.defaultCurrency !== 'string' ||
    typeof payload.country !== 'string'
  ) {
    return null;
  }

  return {
    importId: row.id,
    userId: row.userId,
    sourceType: payload.sourceType,
    filename: payload.filename ?? null,
    rows: payload.rows,
    mapping: payload.mapping ?? null,
    headers: payload.headers ?? null,
    rawCells: payload.rawCells ?? null,
    rawLines: payload.rawLines ?? null,
    rowNumbers: payload.rowNumbers,
    dateOrder: payload.dateOrder,
    defaultCurrency: payload.defaultCurrency,
    country: payload.country,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

const postgresPreviewStore: PreviewStore = {
  save: async (preview) => {
    const { importId, userId, createdAt: _createdAt, expiresAt, ...payload } = preview;

    await importPreviewRepository.create({
      id: importId,
      userId,
      payload: payload as unknown as Parameters<
        typeof importPreviewRepository.create
      >[0]['payload'],
      expiresAt,
    });
  },
  find: async (importId, userId, now) => {
    const row = await importPreviewRepository.findUsable(importId, userId, now);

    return row === null ? null : toStoredPreview(row);
  },
  consume: (importId, userId, now) => importPreviewRepository.consume(importId, userId, now),
};

/* -------------------------------------------------------------------------- */

const memoryPreviewStore = createMemoryPreviewStore();

let override: PreviewStore | null = null;

/** Substitue le magasin. Réservé aux tests. */
export function setPreviewStoreForTests(store: PreviewStore | null): void {
  override = store;
}

function activeStore(): PreviewStore {
  if (override !== null) {
    return override;
  }

  return getServerEnv().IMPORT_PREVIEW_STORE === 'postgres'
    ? postgresPreviewStore
    : memoryPreviewStore;
}

function previewTtlMs(): number {
  return getServerEnv().IMPORT_PREVIEW_TTL_MINUTES * 60 * 1000;
}

export function createPreviewId(): string {
  return `imp_${randomBytes(16).toString('hex')}`;
}

export async function storePreview(
  preview: PreviewPayload,
  now: Date = new Date(),
): Promise<StoredPreview> {
  const stored: StoredPreview = {
    ...preview,
    createdAt: now,
    expiresAt: new Date(now.getTime() + previewTtlMs()),
  };

  await activeStore().save(stored);

  return stored;
}

/**
 * Renvoie l'aperçu s'il appartient à `userId`, n'a pas expiré et n'a pas déjà
 * été consommé.
 *
 * Un aperçu appartenant à un autre utilisateur est traité exactement comme un
 * aperçu inexistant : aucune information ne fuite sur son existence.
 */
export async function getPreview(
  importId: string,
  userId: string,
  now: Date = new Date(),
): Promise<StoredPreview | null> {
  return activeStore().find(importId, userId, now);
}

/**
 * Marque l'aperçu comme consommé : une confirmation ne se rejoue pas.
 *
 * Renvoie `false` si un autre appel l'a consommé d'abord — c'est le point de
 * sérialisation entre deux confirmations concurrentes du même import.
 */
export async function consumePreview(
  importId: string,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return activeStore().consume(importId, userId, now);
}

/** Vide le magasin en mémoire — réservé aux tests. */
export function resetPreviewStore(): void {
  memoryPreviewStore.clear();
}
