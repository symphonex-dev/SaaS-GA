import type { ComparisonOffer, ComparisonOfferAudit, Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

/**
 * Accès aux `ComparisonOffer` et à leur journal d'audit
 * (`specs/comparateur-et-assistant-ia.md` A.7 et A.8).
 *
 * La base d'offres est **globale**, pas un contenu utilisateur : elle n'est
 * donc pas filtrée par `userId`. Aucune donnée personnelle n'y figure, et
 * aucune écriture n'y est possible en dehors des routes d'administration.
 */
export interface OfferWriteData {
  serviceName: string;
  country: string;
  /** Représentation décimale exacte de `Decimal(19, 4)`, jamais un flottant. */
  verifiedPrice: string;
  currency: string;
  billingCycle: 'MONTHLY' | 'YEARLY';
  featuresIncluded: Prisma.InputJsonValue;
  limits: Prisma.InputJsonValue;
  commitmentDuration: number | null;
  directOfficialUrl: string;
  lastVerifiedAt: Date;
  nextCheckAt: Date;
  affiliateNote: string | null;
  affiliateUrl: string | null;
}

export interface AuditWriteData {
  offerId: string;
  action: string;
  actorUserId: string;
  actorEmail: string;
  before: Prisma.InputJsonValue | null;
  after: Prisma.InputJsonValue | null;
}

/** Entrée d'audit calculée à partir de la ligne réellement écrite. */
export type AuditFor = (offer: ComparisonOffer) => AuditWriteData;

/**
 * Colonnes d'une entrée d'audit.
 *
 * Un instantané absent est laissé de côté plutôt qu'écrit à `JsonNull` : la
 * colonne reste alors un vrai NULL SQL, relu tel quel.
 */
function auditColumns(data: AuditWriteData): Prisma.ComparisonOfferAuditCreateInput {
  return {
    offerId: data.offerId,
    action: data.action,
    actorUserId: data.actorUserId,
    actorEmail: data.actorEmail,
    ...(data.before === null ? {} : { before: data.before }),
    ...(data.after === null ? {} : { after: data.after }),
  };
}

export const comparisonRepository = {
  /**
   * Offres candidates d'un pays.
   *
   * Les offres expirées sont exclues dès la requête : une offre dont la date
   * de prochaine vérification est dépassée n'est plus une alternative (A.6).
   */
  async listCandidates(country: string, now: Date): Promise<ComparisonOffer[]> {
    return prisma.comparisonOffer.findMany({
      where: { country, nextCheckAt: { gte: now } },
      orderBy: { serviceName: 'asc' },
    });
  },

  /** Liste d'administration : aucune exclusion, y compris les offres périmées. */
  async listAll(filters: { country?: string; serviceName?: string }): Promise<ComparisonOffer[]> {
    return prisma.comparisonOffer.findMany({
      where: {
        ...(filters.country === undefined ? {} : { country: filters.country }),
        ...(filters.serviceName === undefined ? {} : { serviceName: filters.serviceName }),
      },
      orderBy: { serviceName: 'asc' },
    });
  },

  async findById(id: string): Promise<ComparisonOffer | null> {
    return prisma.comparisonOffer.findUnique({ where: { id } });
  },

  /*
   * Écritures auditées (A.8).
   *
   * L'offre et sa trace sont écrites dans **une même transaction** : si la
   * trace ne peut pas être écrite, la modification est annulée. Une offre ne
   * peut donc jamais changer sans laisser de trace. Le journal est en ajout
   * seul : aucune méthode ne modifie ni ne supprime une entrée d'audit.
   */

  async createAudited(data: OfferWriteData, auditFor: AuditFor): Promise<ComparisonOffer> {
    return prisma.$transaction(async (tx) => {
      const created = await tx.comparisonOffer.create({ data });

      await tx.comparisonOfferAudit.create({ data: auditColumns(auditFor(created)) });

      return created;
    });
  },

  async updateAudited(
    id: string,
    data: Partial<OfferWriteData>,
    auditFor: AuditFor,
  ): Promise<ComparisonOffer> {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.comparisonOffer.update({
        where: { id },
        data: { ...data, updatedAt: new Date() },
      });

      await tx.comparisonOfferAudit.create({ data: auditColumns(auditFor(updated)) });

      return updated;
    });
  },

  async deleteAudited(id: string, audit: AuditWriteData): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.comparisonOffer.delete({ where: { id } });
      // La trace survit à l'offre : elle conserve l'état « avant » complet.
      await tx.comparisonOfferAudit.create({ data: auditColumns(audit) });
    });
  },

  async listAudits(offerId: string): Promise<ComparisonOfferAudit[]> {
    return prisma.comparisonOfferAudit.findMany({
      where: { offerId },
      orderBy: { createdAt: 'asc' },
    });
  },
};
