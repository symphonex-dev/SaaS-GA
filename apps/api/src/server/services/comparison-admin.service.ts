import {
  ERROR_CODES,
  comparisonOfferInputSchema,
  fromMinorUnits,
  type ComparisonOfferAuditDto,
  type ComparisonOfferDto,
  type ComparisonOfferInput,
  type ComparisonOfferPatch,
  type ComparisonOfferQuery,
  type ComparisonOfferVerifyInput,
  type OfferAuditAction,
} from '@subscription-manager/shared';
import type { ComparisonOffer, ComparisonOfferAudit, Prisma } from '@prisma/client';

import { AppError } from '@/lib/api/errors';
import { resolveCurrency } from '@/lib/finance/currency';
import { minorUnitsToDatabaseDecimal } from '@/lib/finance/money';
import type { AdminActor } from '@/server/admin/admin-access';
import {
  comparisonRepository,
  type AuditWriteData,
  type OfferWriteData,
} from '@/server/repositories/comparison.repository';
import { toOfferDto } from '@/server/services/comparison.service';

/**
 * Administration de la base d'offres
 * (`specs/comparateur-et-assistant-ia.md` A.8).
 *
 * Trois garanties tenues ici :
 *  - **aucun prix n'est inventé** : chaque écriture provient d'une saisie
 *    humaine validée par `comparisonOfferInputSchema`, jamais d'une IA ni
 *    d'une collecte automatique (A.1, CLAUDE.md §5.12) ;
 *  - **toute modification est auditée** : qui, quand, avant/après, dans une
 *    même transaction que l'écriture — une offre ne peut pas changer sans
 *    laisser de trace ;
 *  - **aucune vérification n'est datée du futur** : la date de vérification
 *    est l'instant où le prix a été constaté. Datée du futur, une offre
 *    paraîtrait fraîche sans l'être (A.6).
 */

/**
 * Tolérance d'horloge entre le poste de l'administrateur et le serveur.
 * Au-delà, une date de vérification postérieure à « maintenant » est refusée.
 */
const VERIFICATION_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Instantané servant d'état « avant » / « après » dans le journal. */
function snapshot(offer: ComparisonOffer): Prisma.InputJsonValue {
  return toOfferDto(offer) as unknown as Prisma.InputJsonValue;
}

function offerNotFound(): AppError {
  return new AppError(ERROR_CODES.NOT_FOUND, 'Offre introuvable.', 'id');
}

/**
 * Traduit une saisie validée en colonnes de base.
 *
 * Le prix arrive en unités mineures entières et repart en décimale exacte
 * pour `Decimal(19, 4)` : à aucun moment il ne passe par un flottant.
 */
function toWriteData(input: ComparisonOfferInput): OfferWriteData {
  const currency = resolveCurrency(input.price.currency);

  return {
    serviceName: input.serviceName,
    country: input.country,
    verifiedPrice: minorUnitsToDatabaseDecimal(BigInt(input.price.minorUnits), currency),
    currency,
    billingCycle: input.billingCycle,
    featuresIncluded: input.featuresIncluded,
    limits: input.limits,
    commitmentDuration: input.commitmentDuration ?? null,
    directOfficialUrl: input.directOfficialUrl,
    lastVerifiedAt: new Date(input.lastVerifiedAt),
    nextCheckAt: new Date(input.nextCheckAt),
    affiliateNote: input.affiliateNote ?? null,
    affiliateUrl: input.affiliateUrl ?? null,
  };
}

/**
 * Reconstruit la saisie complète d'une offre existante, pour revalider un
 * patch sur l'offre **fusionnée**.
 *
 * Les invariants d'une offre (`nextCheckAt` postérieur à `lastVerifiedAt`, lien
 * affilié accompagné de sa mention) portent sur des couples de champs : les
 * vérifier sur le seul patch laisserait passer une offre incohérente.
 */
function toInputShape(offer: ComparisonOffer): ComparisonOfferInput {
  const dto = toOfferDto(offer);

  return {
    serviceName: dto.serviceName,
    country: dto.country,
    price: dto.price,
    billingCycle: dto.billingCycle,
    featuresIncluded: dto.featuresIncluded,
    limits: dto.limits,
    commitmentDuration: dto.commitmentDuration,
    directOfficialUrl: dto.directOfficialUrl,
    lastVerifiedAt: dto.lastVerifiedAt,
    nextCheckAt: dto.nextCheckAt,
    affiliateNote: dto.affiliateNote,
    affiliateUrl: dto.affiliateUrl,
  };
}

/**
 * Refuse une date de vérification future.
 *
 * Contrôle serveur, et non dans le schéma partagé : il dépend de l'horloge, et
 * un schéma Zod doit rester une fonction pure de son entrée.
 */
function assertVerifiedInThePast(verifiedAt: string, now: Date, field: string): void {
  if (Date.parse(verifiedAt) > now.getTime() + VERIFICATION_CLOCK_SKEW_MS) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Date de vérification future.', field);
  }
}

/** Revalide l'offre fusionnée ; une saisie incohérente est rejetée en bloc. */
function mergeAndValidate(
  offer: ComparisonOffer,
  patch: ComparisonOfferPatch,
): ComparisonOfferInput {
  const merged = { ...toInputShape(offer), ...patch };
  const parsed = comparisonOfferInputSchema.safeParse(merged);

  if (!parsed.success) {
    // Le champ fautif est exposé, jamais la valeur reçue.
    const field = parsed.error.issues[0]?.path.join('.');

    throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Offre invalide.', field);
  }

  return parsed.data;
}

function toAuditDto(audit: ComparisonOfferAudit): ComparisonOfferAuditDto {
  return {
    id: audit.id,
    offerId: audit.offerId,
    action: audit.action as OfferAuditAction,
    actorEmail: audit.actorEmail,
    before: (audit.before ?? null) as ComparisonOfferDto | null,
    after: (audit.after ?? null) as ComparisonOfferDto | null,
    createdAt: audit.createdAt.toISOString(),
  };
}

/**
 * Contenu de la trace.
 *
 * L'instantané « avant » est pris **avant** l'écriture, sinon il refléterait
 * l'état « après ». L'instantané « après » est pris sur la ligne réellement
 * écrite, dans la transaction (`comparisonRepository.*Audited`).
 */
function auditEntry(
  actor: AdminActor,
  action: OfferAuditAction,
  offerId: string,
  before: Prisma.InputJsonValue | null,
  after: Prisma.InputJsonValue | null,
): AuditWriteData {
  return { offerId, action, actorUserId: actor.userId, actorEmail: actor.email, before, after };
}

export const comparisonAdminService = {
  async list(query: ComparisonOfferQuery): Promise<{ offers: ComparisonOfferDto[] }> {
    const offers = await comparisonRepository.listAll({
      ...(query.country === undefined ? {} : { country: query.country }),
      ...(query.serviceName === undefined ? {} : { serviceName: query.serviceName }),
    });

    return { offers: offers.map((offer) => toOfferDto(offer)) };
  },

  async create(
    actor: AdminActor,
    input: ComparisonOfferInput,
    now: Date = new Date(),
  ): Promise<ComparisonOfferDto> {
    assertVerifiedInThePast(input.lastVerifiedAt, now, 'lastVerifiedAt');

    // Pas d'état « avant » à la création : le journal le laisse à `null`.
    const created = await comparisonRepository.createAudited(toWriteData(input), (offer) =>
      auditEntry(actor, 'CREATE', offer.id, null, snapshot(offer)),
    );

    return toOfferDto(created);
  },

  async update(
    actor: AdminActor,
    id: string,
    patch: ComparisonOfferPatch,
    now: Date = new Date(),
  ): Promise<ComparisonOfferDto> {
    const before = await comparisonRepository.findById(id);

    if (before === null) {
      throw offerNotFound();
    }

    const merged = mergeAndValidate(before, patch);

    if (patch.lastVerifiedAt !== undefined) {
      assertVerifiedInThePast(patch.lastVerifiedAt, now, 'lastVerifiedAt');
    }

    const beforeSnapshot = snapshot(before);
    const after = await comparisonRepository.updateAudited(id, toWriteData(merged), (offer) =>
      auditEntry(actor, 'UPDATE', id, beforeSnapshot, snapshot(offer)),
    );

    return toOfferDto(after);
  },

  async remove(actor: AdminActor, id: string): Promise<{ deleted: true }> {
    const before = await comparisonRepository.findById(id);

    if (before === null) {
      throw offerNotFound();
    }

    // L'audit survit à l'offre et conserve l'état « avant » complet.
    await comparisonRepository.deleteAudited(
      id,
      auditEntry(actor, 'DELETE', id, snapshot(before), null),
    );

    return { deleted: true };
  },

  /**
   * Revérification manuelle d'une offre (A.6).
   *
   * Sans prix fourni, seules les dates bougent : le montant reste celui déjà
   * vérifié, jamais une valeur devinée. C'est le seul moyen de faire repasser
   * une offre `STALE` en `FRESH`.
   */
  async verify(
    actor: AdminActor,
    id: string,
    input: ComparisonOfferVerifyInput,
    now: Date = new Date(),
  ): Promise<ComparisonOfferDto> {
    const before = await comparisonRepository.findById(id);

    if (before === null) {
      throw offerNotFound();
    }

    assertVerifiedInThePast(input.verifiedAt, now, 'verifiedAt');

    const currency = resolveCurrency(before.currency);
    const price =
      input.price === undefined
        ? undefined
        : { minorUnits: input.price.minorUnits, currency: input.price.currency };

    if (price !== undefined && price.currency !== currency) {
      // Changer la devise d'une offre reviendrait à en créer une autre.
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Devise inchangeable.', 'price.currency');
    }

    const merged = mergeAndValidate(before, {
      lastVerifiedAt: input.verifiedAt,
      nextCheckAt: input.nextCheckAt,
      ...(price === undefined ? {} : { price }),
    });

    const beforeSnapshot = snapshot(before);
    const after = await comparisonRepository.updateAudited(id, toWriteData(merged), (offer) =>
      auditEntry(actor, 'VERIFY', id, beforeSnapshot, snapshot(offer)),
    );

    return toOfferDto(after);
  },

  async audits(offerId: string): Promise<{ audits: ComparisonOfferAuditDto[] }> {
    const rows = await comparisonRepository.listAudits(offerId);

    return { audits: rows.map((row) => toAuditDto(row)) };
  },
};

/** Réexporté pour les tests d'arrondi de prix : jamais de flottant. */
export { fromMinorUnits };
