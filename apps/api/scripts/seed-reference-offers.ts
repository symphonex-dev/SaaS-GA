import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  comparisonOfferInputSchema,
  emailSchema,
  type ComparisonOfferDto,
  type ComparisonOfferInput,
} from '@subscription-manager/shared';

import {
  NEXT_CHECK_AT,
  REFERENCE_OFFERS,
  VERIFIED_AT,
  type ReferenceOffer,
} from './reference-offers';

/**
 * Alimente la base d'offres du comparateur avec les offres de référence
 * (`reference-offers.ts`). Lancé depuis `apps/api` :
 *
 *   npx tsx scripts/seed-reference-offers.ts --actor <adresse> [--apply]
 *
 * Sans `--apply`, rien n'est écrit : le script affiche, offre par offre, ce
 * qu'il ferait (création, mise à jour, inchangée).
 *
 * Toutes les écritures passent par `comparisonAdminService`, comme les routes
 * d'administration : même validation (lien HTTPS, date de vérification non
 * future…) et même journal d'audit, au nom du compte `--actor`, qui doit
 * exister. Une offre est identifiée par service, pays, devise, périodicité et
 * nom de formule : relancer le script met à jour l'offre existante au lieu
 * d'en créer une seconde. Les offres absentes de la liste ne sont pas
 * touchées.
 *
 * Contrairement au seed de démonstration, ces offres sont destinées à la
 * production. La base visée (`DATABASE_URL`, ou à défaut
 * `apps/api/.env.local`) est affichée avant toute écriture.
 */

const COUNTRY = 'FR';
const CURRENCY = 'EUR';
const API_DIR = path.resolve(__dirname, '..');

type Action = 'CRÉATION' | 'MISE À JOUR' | 'INCHANGÉE';

interface PlannedOffer {
  input: ComparisonOfferInput;
  key: string;
  action: Action;
  existingId: string | null;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function loadDatabaseUrl(): URL {
  const envFile = path.join(API_DIR, '.env.local');

  if (process.env.DATABASE_URL === undefined && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  const raw = process.env.DATABASE_URL;

  if (raw === undefined || raw.length === 0) {
    fail('DATABASE_URL introuvable (environnement ou apps/api/.env.local).');
  }

  try {
    return new URL(raw);
  } catch {
    fail('DATABASE_URL illisible.');
  }
}

/** « 7.99 » → « 799 », par manipulation de chaîne : jamais de flottant (CLAUDE.md §5.2). */
function toMinorUnits(priceEur: string): string {
  const match = /^(\d+)\.(\d{2})$/.exec(priceEur);

  if (match === null) {
    fail(`Prix illisible : ${priceEur}`);
  }

  return BigInt(`${match[1] ?? ''}${match[2] ?? ''}`).toString();
}

function offerKey(offer: {
  serviceName: string;
  country: string;
  price: { currency: string };
  billingCycle: string;
  featuresIncluded: readonly string[];
}): string {
  return [
    offer.serviceName,
    offer.country,
    offer.price.currency,
    offer.billingCycle,
    offer.featuresIncluded[0] ?? '',
  ].join(' | ');
}

function toInput(offer: ReferenceOffer): ComparisonOfferInput {
  const parsed = comparisonOfferInputSchema.safeParse({
    serviceName: offer.serviceName,
    country: COUNTRY,
    price: { minorUnits: toMinorUnits(offer.priceEur), currency: CURRENCY },
    billingCycle: offer.billingCycle,
    featuresIncluded: offer.features,
    limits: offer.limits,
    // Un forfait annuel couvre douze mois payés d'avance.
    commitmentDuration: offer.billingCycle === 'YEARLY' ? 12 : null,
    directOfficialUrl: offer.directOfficialUrl,
    lastVerifiedAt: VERIFIED_AT,
    nextCheckAt: NEXT_CHECK_AT,
    affiliateNote: null,
    affiliateUrl: null,
  });

  if (!parsed.success) {
    fail(
      `Offre invalide (${offer.serviceName} ${offer.features[0] ?? ''}) : ${parsed.error.issues[0]?.path.join('.') ?? ''}`,
    );
  }

  return parsed.data;
}

/** Sérialisation à clés triées : PostgreSQL réordonne les clés d'un `jsonb`. */
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stable(entry)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}

function isUnchanged(existing: ComparisonOfferDto, input: ComparisonOfferInput): boolean {
  return (
    existing.price.minorUnits === input.price.minorUnits &&
    stable(existing.featuresIncluded) === stable(input.featuresIncluded) &&
    stable(existing.limits) === stable(input.limits) &&
    existing.commitmentDuration === (input.commitmentDuration ?? null) &&
    existing.directOfficialUrl === input.directOfficialUrl &&
    Date.parse(existing.lastVerifiedAt) === Date.parse(input.lastVerifiedAt) &&
    Date.parse(existing.nextCheckAt) === Date.parse(input.nextCheckAt)
  );
}

function plan(inputs: readonly ComparisonOfferInput[], existing: readonly ComparisonOfferDto[]) {
  return inputs.map((input): PlannedOffer => {
    const key = offerKey(input);
    const matches = existing.filter((offer) => offerKey(offer) === key);

    if (matches.length > 1) {
      fail(`Plusieurs offres existantes correspondent à « ${key} » : à dédoublonner d'abord.`);
    }

    const [match] = matches;

    if (match === undefined) {
      return { input, key, action: 'CRÉATION', existingId: null };
    }

    return {
      input,
      key,
      action: isUnchanged(match, input) ? 'INCHANGÉE' : 'MISE À JOUR',
      existingId: match.id,
    };
  });
}

function formatEur(minorUnits: string): string {
  const padded = minorUnits.padStart(3, '0');

  return `${padded.slice(0, -2)},${padded.slice(-2)} €`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const actorIndex = args.indexOf('--actor');
  const actorEmail = emailSchema.safeParse(actorIndex >= 0 ? args[actorIndex + 1] : '');

  if (!actorEmail.success) {
    fail('Usage : npx tsx scripts/seed-reference-offers.ts --actor <adresse> [--apply]');
  }

  const inputs = REFERENCE_OFFERS.map((offer) => toInput(offer));
  const keys = new Set(inputs.map((input) => offerKey(input)));

  if (keys.size !== inputs.length) {
    fail('reference-offers.ts contient deux offres de même service, périodicité et formule.');
  }

  const database = loadDatabaseUrl();

  // Imports différés : le client Prisma ne doit être construit qu'une fois
  // `DATABASE_URL` chargée.
  const [{ prisma }, { maskEmailAddress }, { userRepository }, { comparisonAdminService }] =
    await Promise.all([
      import('@/lib/db/prisma'),
      import('@/lib/mail/mailer'),
      import('@/server/repositories/user.repository'),
      import('@/server/services/comparison-admin.service'),
    ]);

  try {
    console.info(`Base visée : ${database.hostname}${database.pathname}`);

    const user = await userRepository.findActiveByEmail(actorEmail.data);

    if (user === null) {
      fail(`Aucun compte actif pour ${maskEmailAddress(actorEmail.data)} : rien n'a été modifié.`);
    }

    const actor = { userId: user.id, email: user.email };
    const { offers: existing } = await comparisonAdminService.list({ country: COUNTRY });
    const planned = plan(inputs, existing);
    const untouched = existing.filter((offer) => !keys.has(offerKey(offer))).length;

    console.info(
      `Auteur des traces d'audit : ${maskEmailAddress(actor.email)} — vérification du ${VERIFIED_AT}, prochaine au plus tard le ${NEXT_CHECK_AT}.`,
    );

    for (const entry of planned) {
      console.info(
        `${entry.action.padEnd(12)} ${entry.key.padEnd(60)} ${formatEur(entry.input.price.minorUnits)}`,
      );
    }

    const count = (action: Action): number =>
      planned.filter((entry) => entry.action === action).length;

    console.info(
      `${String(count('CRÉATION'))} création(s), ${String(count('MISE À JOUR'))} mise(s) à jour, ${String(count('INCHANGÉE'))} inchangée(s) ; ${String(untouched)} autre(s) offre(s) FR non gérée(s) par ce script, laissée(s) telle(s) quelle(s).`,
    );

    if (!apply) {
      console.info('Aperçu seulement : relancer avec --apply pour écrire.');
      return;
    }

    let written = 0;

    for (const entry of planned) {
      if (entry.action === 'CRÉATION') {
        await comparisonAdminService.create(actor, entry.input);
        written += 1;
      } else if (entry.action === 'MISE À JOUR' && entry.existingId !== null) {
        await comparisonAdminService.update(actor, entry.existingId, entry.input);
        written += 1;
      }
    }

    const { offers: after } = await comparisonAdminService.list({ country: COUNTRY });

    console.info(
      `${String(written)} écriture(s) auditée(s). Offres FR en base : ${String(after.length)}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Une erreur applicative porte un code et un champ fixes ; toute autre
  // erreur est réduite à son nom, son message pouvant contenir l'URL de la base.
  if (error instanceof Error && 'code' in error && error.name === 'AppError') {
    const field = (error as Error & { field?: string }).field;

    console.error(`Échec : ${String(error.code)}${field === undefined ? '' : ` (${field})`}`);
  } else {
    console.error(`Échec : ${error instanceof Error ? error.name : typeof error}`);
  }

  process.exitCode = 1;
});
