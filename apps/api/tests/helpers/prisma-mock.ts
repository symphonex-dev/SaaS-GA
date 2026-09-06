import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

/**
 * Double en mémoire du client Prisma, utilisé par toute la suite de tests.
 *
 * `vitest.config.mts` fait pointer l'alias `@/lib/db/prisma` vers ce module :
 * aucun test ne peut donc atteindre une vraie base, et les tests d'intégration
 * exercent le code réel des routes, services et repositories sans dépendre
 * d'un PostgreSQL disponible.
 *
 * Ce double implémente exactement le sous-ensemble de l'API Prisma utilisé par
 * les repositories — pas davantage. Toute nouvelle requête dans un repository
 * doit être ajoutée ici, ce qui garde visible la surface réellement utilisée.
 *
 * Il ne remplace pas une validation contre PostgreSQL : les contraintes réelles
 * (unicité, cascades, types `Decimal`) restent à vérifier avec
 * `prisma migrate deploy` sur une base réelle.
 */

/** Une ligne stockée : les valeurs sont opaques pour le double. */
export type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
type OrderBy = Record<string, 'asc' | 'desc'>;

/** `include` Prisma : booleen simple, ou objet portant un `include` imbrique. */
export type IncludeSpec = Record<string, boolean | { include?: IncludeSpec } | undefined>;

let idCounter = 0;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${String(idCounter).padStart(6, '0')}`;
}

function matches(row: Row, where: Where | undefined): boolean {
  if (where === undefined) {
    return true;
  }

  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];

    if (expected === null) {
      return actual === null || actual === undefined;
    }

    if (expected instanceof Date && actual instanceof Date) {
      return expected.getTime() === actual.getTime();
    }

    // Opérateurs Prisma utilisés par les repositories : { gte }, { lte }, { not }.
    if (typeof expected === 'object' && !(expected instanceof Date)) {
      return matchesOperators(actual, expected as Record<string, unknown>);
    }

    return actual === expected;
  });
}

function comparable(value: unknown): number | null {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'number') {
    return value;
  }

  return null;
}

function matchesOperators(actual: unknown, operators: Record<string, unknown>): boolean {
  return Object.entries(operators).every(([operator, expected]) => {
    if (operator === 'not') {
      return expected === null ? actual !== null && actual !== undefined : actual !== expected;
    }

    const left = comparable(actual);
    const right = comparable(expected);

    if (left === null || right === null) {
      return false;
    }

    switch (operator) {
      case 'gte':
        return left >= right;
      case 'gt':
        return left > right;
      case 'lte':
        return left <= right;
      case 'lt':
        return left < right;
      default:
        return false;
    }
  });
}

function sortRows(rows: Row[], orderBy: OrderBy | undefined): Row[] {
  if (orderBy === undefined) {
    return rows;
  }

  const entry = Object.entries(orderBy)[0];

  if (entry === undefined) {
    return rows;
  }

  const [key, direction] = entry;

  return [...rows].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    const leftValue = left instanceof Date ? left.getTime() : Number(left ?? 0);
    const rightValue = right instanceof Date ? right.getTime() : Number(right ?? 0);
    const comparison = leftValue - rightValue;

    return direction === 'desc' ? -comparison : comparison;
  });
}

interface TableOptions {
  idPrefix: string;
  /** Champ servant de clé primaire (`userId` pour `AiQuota`). */
  primaryKey?: string;
  /** Valeurs par défaut appliquées à la création. */
  defaults?: () => Row;
  /** Résolution des relations `include`, avec leurs propres relations. */
  include?: Record<string, (row: Row, nested?: IncludeSpec) => unknown>;
}

class InMemoryTable {
  readonly rows: Row[] = [];

  constructor(private readonly options: TableOptions) {}

  private get primaryKey(): string {
    return this.options.primaryKey ?? 'id';
  }

  private withInclude(row: Row, include: IncludeSpec | undefined): Row {
    if (include === undefined) {
      return row;
    }

    const resolved: Row = { ...row };

    for (const [relation, option] of Object.entries(include)) {
      const resolver = this.options.include?.[relation];

      if (option === false || option === undefined || resolver === undefined) {
        continue;
      }

      // Prisma accepte `{ user: true }` comme `{ user: { include: {...} } }` :
      // le double reproduit les deux formes pour rester fidele aux requetes.
      const nested = typeof option === 'object' ? option.include : undefined;

      resolved[relation] = resolver(row, nested);
    }

    return resolved;
  }

  create({ data }: { data: Row }): Promise<Row> {
    const providedKey = data[this.primaryKey];

    // Contrainte de cle primaire, reproduite fidelement : sans elle, deux
    // ecritures concurrentes creeraient deux lignes la ou PostgreSQL en refuse
    // une (cas du quota IA, `specs/comparateur-et-assistant-ia.md` B.8).
    if (
      providedKey !== undefined &&
      this.rows.some((existing) => existing[this.primaryKey] === providedKey)
    ) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'mock',
      });
    }

    const row: Row = {
      [this.primaryKey]: nextId(this.options.idPrefix),
      ...(this.options.defaults?.() ?? {}),
      ...data,
    };

    this.rows.push(row);
    return Promise.resolve(row);
  }

  findFirst({
    where,
    include,
  }: { where?: Where; include?: IncludeSpec } = {}): Promise<Row | null> {
    const row = this.rows.find((candidate) => matches(candidate, where));

    return Promise.resolve(row === undefined ? null : this.withInclude(row, include));
  }

  findUnique({
    where,
    include,
  }: {
    where: Where;
    include?: IncludeSpec;
    select?: Record<string, boolean>;
  }): Promise<Row | null> {
    const row = this.rows.find((candidate) => matches(candidate, where));
    return Promise.resolve(row === undefined ? null : this.withInclude(row, include));
  }

  findMany({
    where,
    orderBy,
    include,
  }: { where?: Where; orderBy?: OrderBy; include?: IncludeSpec } = {}): Promise<Row[]> {
    const rows = sortRows(
      this.rows.filter((row) => matches(row, where)),
      orderBy,
    );

    return Promise.resolve(rows.map((row) => this.withInclude(row, include)));
  }

  update({ where, data }: { where: Where; data: Row }): Promise<Row> {
    const row = this.rows.find((candidate) => matches(candidate, where));

    if (row === undefined) {
      throw new Error('Enregistrement introuvable (update).');
    }

    Object.assign(row, data);
    return Promise.resolve(row);
  }

  updateMany({ where, data }: { where: Where; data: Row }): Promise<{ count: number }> {
    const targets = this.rows.filter((row) => matches(row, where));

    for (const row of targets) {
      Object.assign(row, data);
    }

    return Promise.resolve({ count: targets.length });
  }

  delete({ where }: { where: Where }): Promise<Row> {
    const index = this.rows.findIndex((row) => matches(row, where));

    if (index === -1) {
      throw new Error('Enregistrement introuvable (delete).');
    }

    const removed = this.rows.splice(index, 1)[0];

    if (removed === undefined) {
      throw new Error('Suppression incohérente.');
    }

    return Promise.resolve(removed);
  }

  deleteMany({ where }: { where?: Where } = {}): Promise<{ count: number }> {
    const kept = this.rows.filter((row) => !matches(row, where));
    const removed = this.rows.length - kept.length;

    this.rows.length = 0;
    this.rows.push(...kept);

    return Promise.resolve({ count: removed });
  }

  count({ where }: { where?: Where } = {}): Promise<number> {
    return Promise.resolve(this.rows.filter((row) => matches(row, where)).length);
  }

  clear(): void {
    this.rows.length = 0;
  }
}

const now = (): Date => new Date();

export interface Tables {
  user: InMemoryTable;
  comparisonOffer: InMemoryTable;
  authSession: InMemoryTable;
  passwordResetToken: InMemoryTable;
  subscription: InMemoryTable;
  expense: InMemoryTable;
  recurringDetection: InMemoryTable;
  userSavingsGoal: InMemoryTable;
  expenseImportBatch: InMemoryTable;
  aiQuota: InMemoryTable;
  comparisonOfferAudit: InMemoryTable;
  storeNotificationEvent: InMemoryTable;
  importPreview: InMemoryTable;
  rateLimitCounter: InMemoryTable;
}

export const tables: Tables = {
  user: new InMemoryTable({
    idPrefix: 'usr',
    defaults: () => ({
      tier: 'FREE',
      language: 'en',
      country: 'US',
      currency: 'EUR',
      createdAt: now(),
      updatedAt: now(),
      deletedAt: null,
    }),
  }),
  authSession: new InMemoryTable({
    idPrefix: 'ses',
    defaults: () => ({
      createdAt: now(),
      lastUsedAt: now(),
      revokedAt: null,
      deviceLabel: null,
    }),
    include: {
      // `User.tier` est derive de l'abonnement : la session le charge avec
      // l'utilisateur (`specs/paiement-in-app.md` §7).
      user: (row, nested) => {
        const user = tables.user.rows.find((candidate) => candidate['id'] === row['userId']);

        if (user === undefined) {
          return null;
        }

        if (nested?.['subscription'] === undefined || nested['subscription'] === false) {
          return user;
        }

        return {
          ...user,
          subscription:
            tables.subscription.rows.find(
              (subscription) => subscription['userId'] === user['id'],
            ) ?? null,
        };
      },
    },
  }),
  passwordResetToken: new InMemoryTable({
    idPrefix: 'prt',
    defaults: () => ({ createdAt: now(), usedAt: null }),
  }),
  subscription: new InMemoryTable({
    idPrefix: 'sub',
    defaults: () => ({
      plan: 'FREE',
      status: 'EXPIRED',
      store: null,
      storeProductId: null,
      storeTransactionId: null,
      storeOriginalTransactionId: null,
      billingCycle: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      createdAt: now(),
      updatedAt: now(),
    }),
  }),
  // Les valeurs par défaut reproduisent celles du schéma Prisma : sans elles,
  // une écriture qui s'appuie sur un défaut de la base (`status`, `frequency`…)
  // se comporterait différemment en test et en production.
  expense: new InMemoryTable({
    idPrefix: 'exp',
    defaults: () => ({
      merchantOverride: null,
      frequency: 'ONCE',
      category: 'OTHER',
      paymentMethod: null,
      notes: null,
      status: 'ACTIVE',
      source: 'IMPORT',
      importBatchId: null,
      createdAt: now(),
    }),
  }),
  recurringDetection: new InMemoryTable({
    idPrefix: 'rec',
    defaults: () => ({ createdAt: now(), updatedAt: now() }),
    include: {
      expense: (row) =>
        tables.expense.rows.find((expense) => expense['id'] === row['expenseId']) ?? null,
    },
  }),
  userSavingsGoal: new InMemoryTable({
    idPrefix: 'gol',
    defaults: () => ({ createdAt: now(), updatedAt: now() }),
  }),
  expenseImportBatch: new InMemoryTable({
    idPrefix: 'bat',
    defaults: () => ({ createdAt: now(), rolledBackAt: null }),
  }),
  aiQuota: new InMemoryTable({
    idPrefix: 'aiq',
    primaryKey: 'userId',
    defaults: () => ({ creditsUsed: 0 }),
  }),
  // L'identifiant vient du store : la contrainte de cle primaire porte a elle
  // seule l'idempotence des notifications (`specs/paiement-in-app.md` §5).
  storeNotificationEvent: new InMemoryTable({
    idPrefix: 'evt',
    defaults: () => ({ processedAt: null, createdAt: now() }),
  }),
  comparisonOfferAudit: new InMemoryTable({
    idPrefix: 'aud',
    defaults: () => ({ before: null, after: null, createdAt: now() }),
  }),
  // Apercu d'import persiste entre `preview` et `confirm` : TTL, proprietaire
  // et consommation unique (`specs/import-releves.md` §2, CLAUDE.md §10.11).
  importPreview: new InMemoryTable({
    idPrefix: 'imp',
    defaults: () => ({ createdAt: now(), consumedAt: null }),
  }),
  // Compteur de rate limiting partage entre instances (CLAUDE.md §10.11).
  // La cle primaire est `key` : c'est elle qui porte l'atomicite de l'upsert.
  rateLimitCounter: new InMemoryTable({
    idPrefix: 'rlc',
    primaryKey: 'key',
    defaults: () => ({ count: 0 }),
  }),
  comparisonOffer: new InMemoryTable({
    idPrefix: 'off',
    defaults: () => ({
      commitmentDuration: null,
      affiliateNote: null,
      affiliateUrl: null,
      createdAt: now(),
      updatedAt: now(),
    }),
  }),
};

/**
 * Requetes SQL brutes utilisees par le code (`$executeRaw`).
 *
 * Une seule famille aujourd'hui : la consommation atomique du quota IA
 * (`specs/comparateur-et-assistant-ia.md` B.8). Chaque enonce est applique
 * **en un seul tour de boucle synchrone**, ce qui reproduit le verrou de ligne
 * de PostgreSQL : c'est precisement ce que le test de concurrence verifie.
 */
function executeRawStatement(sql: string, values: readonly unknown[]): number {
  const statement = sql.replace(/\s+/g, ' ').trim();

  if (!statement.startsWith('UPDATE ai_quotas')) {
    throw new Error(`Requete SQL brute non prise en charge par le double : ${statement}`);
  }

  // Les parametres sont identifies par leur type, pas par leur position :
  // l'ordre des interpolations differe d'un enonce a l'autre.
  const userId = values.find((value): value is string => typeof value === 'string');
  const periodStart = values.find((value): value is Date => value instanceof Date);
  const creditsGranted = values.find((value): value is number => typeof value === 'number');

  if (userId === undefined || periodStart === undefined) {
    throw new Error('Parametres manquants dans la requete SQL brute.');
  }

  const rows = tables.aiQuota.rows;
  const samePeriod = (row: Row): boolean =>
    (row['periodStart'] as Date).getTime() === periodStart.getTime();

  // Bascule de periode : remise a zero des credits consommes.
  if (statement.includes('period_start <>')) {
    const row = rows.find((candidate) => candidate['userId'] === userId && !samePeriod(candidate));

    if (row === undefined || creditsGranted === undefined) {
      return 0;
    }

    row['periodStart'] = periodStart;
    row['creditsUsed'] = 0;
    row['creditsGranted'] = creditsGranted;

    return 1;
  }

  // Changement d'offre en cours de mois : seuls les credits accordes bougent.
  if (statement.includes('credits_granted <>')) {
    const row = rows.find(
      (candidate) =>
        candidate['userId'] === userId &&
        samePeriod(candidate) &&
        candidate['creditsGranted'] !== creditsGranted,
    );

    if (row === undefined || creditsGranted === undefined) {
      return 0;
    }

    row['creditsGranted'] = creditsGranted;

    return 1;
  }

  // Increment conditionnel : c'est LE point d'atomicite du quota (B.8).
  if (statement.includes('credits_used < credits_granted')) {
    const row = rows.find(
      (candidate) =>
        candidate['userId'] === userId &&
        samePeriod(candidate) &&
        (candidate['creditsUsed'] as number) < (candidate['creditsGranted'] as number),
    );

    if (row === undefined) {
      return 0;
    }

    row['creditsUsed'] = (row['creditsUsed'] as number) + 1;

    return 1;
  }

  throw new Error(`Requete SQL brute non prise en charge par le double : ${statement}`);
}

/**
 * Requetes SQL brutes qui **renvoient des lignes** (`$queryRaw`).
 *
 * Une seule famille : l'increment atomique du rate limiting. Comme pour le
 * quota IA, la mutation est appliquee **en un seul tour de boucle synchrone**,
 * ce qui reproduit le `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` de
 * PostgreSQL : deux appels concurrents ne peuvent pas lire la meme valeur.
 */
function queryRawStatement(sql: string, values: readonly unknown[]): Row[] {
  const statement = sql.replace(/\s+/g, ' ').trim();

  if (!statement.startsWith('INSERT INTO rate_limit_counters')) {
    throw new Error(`Requete SQL brute non prise en charge par le double : ${statement}`);
  }

  const key = values.find((value): value is string => typeof value === 'string');
  const expiresAt = values.find((value): value is Date => value instanceof Date);

  if (key === undefined || expiresAt === undefined) {
    throw new Error('Parametres manquants dans la requete SQL brute.');
  }

  const rows = tables.rateLimitCounter.rows;
  const existing = rows.find((row) => row['key'] === key);

  if (existing === undefined) {
    rows.push({ key, count: 1, expiresAt });

    return [{ count: 1 }];
  }

  existing['count'] = (existing['count'] as number) + 1;

  return [{ count: existing['count'] }];
}

type MockClient = Tables & {
  $transaction: <T>(fn: (tx: MockClient) => Promise<T>) => Promise<T>;
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;
  $disconnect: () => Promise<void>;
};

const client: MockClient = {
  ...tables,
  $transaction: async <T>(fn: (tx: MockClient) => Promise<T>): Promise<T> => fn(client),
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]): Promise<number> =>
    // La mutation est faite de facon synchrone AVANT de rendre la main : aucun
    // point d'attente ne peut s'intercaler entre la lecture et l'ecriture.
    Promise.resolve(executeRawStatement(strings.join(' ? '), values)),
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> =>
    Promise.resolve(queryRawStatement(strings.join(' ? '), values)),
  $disconnect: async (): Promise<void> => {
    await Promise.resolve();
  },
};

/** Exporté sous le nom attendu par `@/lib/db/prisma`. */
export const prisma = client as unknown as PrismaClient;

/** Vide toutes les tables — à appeler dans un `beforeEach`. */
export function resetDatabase(): void {
  for (const key of Object.keys(tables) as Array<keyof Tables>) {
    tables[key].clear();
  }
}
