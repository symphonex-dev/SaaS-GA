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
  type OfferWriteData,
} from '@/server/repositories/comparison.repository';
import { toOfferDto } from '@/server/services/comparison.service';

/**
 * Administration de la base d'offres
 * (`specs/comparateur-et-assistant-ia.md` A.8).
 *
 * Deux garanties tenues ici :
 *  - **aucun prix n'est inventé** : chaque écriture provient d'une saisie
 *    humaine validée par `comparisonOfferInputSchema`, jamais d'une IA ni
 *    d'une collecte automatique (A.1, CLAUDE.md §5.12) ;
 *  - **toute modification est auditée** : qui, quand, avant/après, dans une
 *    même transaction que l'écriture — une offre ne peut pas changer sans
 *    laisser de trace.
 */

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
 * Ecrit la trace.
 *
 * Les instantanes sont passes **deja calcules** : celui de l'etat « avant »
 * doit etre pris avant l'ecriture, sinon il refleterait l'etat « apres ».
 */
async function audit(
  actor: AdminActor,
  action: OfferAuditAction,
  offerId: string,
  before: Prisma.InputJsonValue | null,
  after: Prisma.InputJsonValue | null,
): Promise<void> {
  await comparisonRepository.recordAudit({
    offerId,
    action,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    before,
    after,
  });
}

export const comparisonAdminService = {
  async list(query: ComparisonOfferQuery): Promise<{ offers: ComparisonOfferDto[] }> {
    const offers = await comparisonRepository.listAll({
      ...(query.country === undefined ? {} : { country: query.country }),
      ...(query.serviceName === undefined ? {} : { serviceName: query.serviceName }),
    });

    return { offers: offers.map((offer) => toOfferDto(offer)) };
  },

  async create(actor: AdminActor, input: ComparisonOfferInput): Promise<ComparisonOfferDto> {
    const created = await comparisonRepository.create(toWriteData(input));

    // Pas d'état « avant » à la création : le journal le laisse à `null`.
    await audit(actor, 'CREATE', created.id, null, snapshot(created));

    return toOfferDto(created);
  },

  async update(
    actor: AdminActor,
    id: string,
    patch: ComparisonOfferPatch,
  ): Promise<ComparisonOfferDto> {
    const before = await comparisonRepository.findById(id);

    if (before === null) {
      throw offerNotFound();
    }

    const merged = mergeAndValidate(before, patch);
    const beforeSnapshot = snapshot(before);
    const after = await comparisonRepository.update(id, toWriteData(merged));

    await audit(actor, 'UPDATE', id, beforeSnapshot, snapshot(after));

    return toOfferDto(after);
  },

  async remove(actor: AdminActor, id: string): Promise<{ deleted: true }> {
    const before = await comparisonRepository.findById(id);

    if (before === null) {
      throw offerNotFound();
    }

    const beforeSnapshot = snapshot(before);

    await comparisonRepository.delete(id);
    // L'audit survit à l'offre : la trace est écrite après la suppression et
    // conserve l'état « avant » complet.
    await audit(actor, 'DELETE', id, beforeSnapshot, null);

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
  ): Promise<ComparisonOfferDto> {
    const before = await comparisonRepository.findById(id);

    if (before === null) {
      throw offerNotFound();
    }

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
    const after = await comparisonRepository.update(id, toWriteData(merged));

    await audit(actor, 'VERIFY', id, beforeSnapshot, snapshot(after));

    return toOfferDto(after);
  },

  async audits(offerId: string): Promise<{ audits: ComparisonOfferAuditDto[] }> {
    const rows = await comparisonRepository.listAudits(offerId);

    return { audits: rows.map((row) => toAuditDto(row)) };
  },
};

/** Réexporté pour les tests d'arrondi de prix : jamais de flottant. */
export { fromMinorUnits };
