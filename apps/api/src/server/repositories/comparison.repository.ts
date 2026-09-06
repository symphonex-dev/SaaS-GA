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

  async create(data: OfferWriteData): Promise<ComparisonOffer> {
    return prisma.comparisonOffer.create({ data });
  },

  async update(id: string, data: Partial<OfferWriteData>): Promise<ComparisonOffer> {
    return prisma.comparisonOffer.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
    });
  },

  async delete(id: string): Promise<void> {
    await prisma.comparisonOffer.delete({ where: { id } });
  },

  /**
   * Écrit une entrée d'audit (A.8).
   *
   * Jamais de mise à jour ni de suppression : le journal est en ajout seul.
   */
  async recordAudit(data: AuditWriteData): Promise<ComparisonOfferAudit> {
    return prisma.comparisonOfferAudit.create({
      // Un instantane absent est laisse de cote plutot qu'ecrit a `JsonNull` :
      // la colonne reste alors un vrai NULL SQL, relu tel quel.
      data: {
        offerId: data.offerId,
        action: data.action,
        actorUserId: data.actorUserId,
        actorEmail: data.actorEmail,
        ...(data.before === null ? {} : { before: data.before }),
        ...(data.after === null ? {} : { after: data.after }),
      },
    });
  },

  async listAudits(offerId: string): Promise<ComparisonOfferAudit[]> {
    return prisma.comparisonOfferAudit.findMany({
      where: { offerId },
      orderBy: { createdAt: 'asc' },
    });
  },
};
