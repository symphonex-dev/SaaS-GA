import type {
  AuthenticatedSessionDto,
  ComparisonOfferAuditDto,
  ComparisonOfferDto,
} from '@subscription-manager/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DELETE as deleteRoute,
  GET as auditRoute,
  PATCH as patchRoute,
} from '@/app/api/admin/comparison-offers/[id]/route';
import { POST as verifyRoute } from '@/app/api/admin/comparison-offers/[id]/verify/route';
import { GET as listRoute, POST as createRoute } from '@/app/api/admin/comparison-offers/route';
import { prisma } from '@/lib/db/prisma';
import { resetServerEnvCache } from '@/lib/env/server';
import { resetRateLimits } from '@/lib/security/rate-limit';

import { createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/**
 * Administration des offres (`specs/comparateur-et-assistant-ia.md` A.8).
 *
 * Deux exigences vérifiées ici : le rôle vient exclusivement du serveur, et
 * toute modification laisse une trace (qui, quand, avant/après).
 */
const ADMIN_EMAIL = 'admin@example.com';

const VALID_OFFER = {
  serviceName: 'Netflix',
  country: 'FR',
  price: { minorUnits: '1099', currency: 'EUR' },
  billingCycle: 'MONTHLY',
  featuresIncluded: ['hd'],
  limits: { screens: 2 },
  commitmentDuration: null,
  directOfficialUrl: 'https://www.netflix.com/fr/',
  lastVerifiedAt: '2026-06-01T00:00:00.000Z',
  nextCheckAt: '2026-07-01T00:00:00.000Z',
  affiliateNote: null,
  affiliateUrl: null,
};

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('administration des offres de comparaison', () => {
  let admin: AuthenticatedSessionDto;
  let standard: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();

    process.env['ADMIN_EMAILS'] = ADMIN_EMAIL;
    resetServerEnvCache();

    admin = await createUserWithSession({ email: ADMIN_EMAIL });
    standard = await createUserWithSession({ email: 'utilisateur@example.com' });
  });

  afterEach(() => {
    delete process.env['ADMIN_EMAILS'];
    resetServerEnvCache();
  });

  async function createOffer(): Promise<ComparisonOfferDto> {
    const { offer } = await expectSuccess<{ offer: ComparisonOfferDto }>(
      await createRoute(
        apiRequest('/api/admin/comparison-offers', {
          method: 'POST',
          token: admin.token,
          body: VALID_OFFER,
        }),
      ),
    );

    return offer;
  }

  it('refuse un utilisateur standard authentifié', async () => {
    const response = await listRoute(
      apiRequest('/api/admin/comparison-offers', { token: standard.token }),
    );

    expect(await expectErrorCode(response)).toBe('ADMIN_FORBIDDEN');
    expect(response.status).toBe(403);
  });

  it('refuse une requête sans session', async () => {
    const response = await listRoute(apiRequest('/api/admin/comparison-offers'));

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });

  it('n’accorde le rôle à personne quand la liste blanche est vide', async () => {
    process.env['ADMIN_EMAILS'] = '';
    resetServerEnvCache();

    const response = await listRoute(
      apiRequest('/api/admin/comparison-offers', { token: admin.token }),
    );

    expect(await expectErrorCode(response)).toBe('ADMIN_FORBIDDEN');
  });

  it('ignore un champ « isAdmin » envoyé par le client', async () => {
    const response = await createRoute(
      apiRequest('/api/admin/comparison-offers', {
        method: 'POST',
        token: standard.token,
        body: { ...VALID_OFFER, isAdmin: true, role: 'ADMIN' },
      }),
    );

    expect(await expectErrorCode(response)).toBe('ADMIN_FORBIDDEN');
  });

  it('crée une offre et journalise l’action', async () => {
    const offer = await createOffer();

    expect(offer.serviceName).toBe('Netflix');
    expect(offer.price.minorUnits).toBe('1099');

    const { audits } = await expectSuccess<{ audits: ComparisonOfferAuditDto[] }>(
      await auditRoute(
        apiRequest(`/api/admin/comparison-offers/${offer.id}`, { token: admin.token }),
        context(offer.id),
      ),
    );

    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('CREATE');
    expect(audits[0]?.actorEmail).toBe(ADMIN_EMAIL);
    expect(audits[0]?.before).toBeNull();
    expect(audits[0]?.after?.serviceName).toBe('Netflix');
  });

  it('journalise l’état avant et après une modification', async () => {
    const offer = await createOffer();

    const { offer: updated } = await expectSuccess<{ offer: ComparisonOfferDto }>(
      await patchRoute(
        apiRequest(`/api/admin/comparison-offers/${offer.id}`, {
          method: 'PATCH',
          token: admin.token,
          body: { price: { minorUnits: '1299', currency: 'EUR' } },
        }),
        context(offer.id),
      ),
    );

    expect(updated.price.minorUnits).toBe('1299');

    const { audits } = await expectSuccess<{ audits: ComparisonOfferAuditDto[] }>(
      await auditRoute(
        apiRequest(`/api/admin/comparison-offers/${offer.id}`, { token: admin.token }),
        context(offer.id),
      ),
    );

    const update = audits.find((entry) => entry.action === 'UPDATE');

    expect(update?.before?.price.minorUnits).toBe('1099');
    expect(update?.after?.price.minorUnits).toBe('1299');
  });

  it('rejette un patch qui rendrait l’offre incohérente', async () => {
    const offer = await createOffer();

    // Prochaine vérification antérieure à la dernière : invariant de l'offre.
    const response = await patchRoute(
      apiRequest(`/api/admin/comparison-offers/${offer.id}`, {
        method: 'PATCH',
        token: admin.token,
        body: { nextCheckAt: '2026-05-01T00:00:00.000Z' },
      }),
      context(offer.id),
    );

    expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
  });

  it('refuse un lien affilié sans mention de commission', async () => {
    const response = await createRoute(
      apiRequest('/api/admin/comparison-offers', {
        method: 'POST',
        token: admin.token,
        body: { ...VALID_OFFER, affiliateUrl: 'https://partenaire.example.com/x' },
      }),
    );

    expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
  });

  it('repousse la fraîcheur sans inventer de prix lors d’une revérification', async () => {
    const offer = await createOffer();

    const { offer: verified } = await expectSuccess<{ offer: ComparisonOfferDto }>(
      await verifyRoute(
        apiRequest(`/api/admin/comparison-offers/${offer.id}/verify`, {
          method: 'POST',
          token: admin.token,
          body: {
            verifiedAt: '2026-06-20T00:00:00.000Z',
            nextCheckAt: '2026-07-20T00:00:00.000Z',
          },
        }),
        context(offer.id),
      ),
    );

    expect(verified.lastVerifiedAt).toBe('2026-06-20T00:00:00.000Z');
    // Prix inchangé : la revérification ne devine jamais un montant.
    expect(verified.price.minorUnits).toBe('1099');
  });

  it('enregistre un prix revérifié à la main', async () => {
    const offer = await createOffer();

    const { offer: verified } = await expectSuccess<{ offer: ComparisonOfferDto }>(
      await verifyRoute(
        apiRequest(`/api/admin/comparison-offers/${offer.id}/verify`, {
          method: 'POST',
          token: admin.token,
          body: {
            verifiedAt: '2026-06-20T00:00:00.000Z',
            nextCheckAt: '2026-07-20T00:00:00.000Z',
            price: { minorUnits: '1199', currency: 'EUR' },
          },
        }),
        context(offer.id),
      ),
    );

    expect(verified.price.minorUnits).toBe('1199');
  });

  it('refuse de changer la devise d’une offre existante', async () => {
    const offer = await createOffer();

    const response = await verifyRoute(
      apiRequest(`/api/admin/comparison-offers/${offer.id}/verify`, {
        method: 'POST',
        token: admin.token,
        body: {
          verifiedAt: '2026-06-20T00:00:00.000Z',
          nextCheckAt: '2026-07-20T00:00:00.000Z',
          price: { minorUnits: '1199', currency: 'USD' },
        },
      }),
      context(offer.id),
    );

    expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
  });

  it('conserve la trace complète après suppression de l’offre', async () => {
    const offer = await createOffer();

    await expectSuccess<{ deleted: true }>(
      await deleteRoute(
        apiRequest(`/api/admin/comparison-offers/${offer.id}`, {
          method: 'DELETE',
          token: admin.token,
        }),
        context(offer.id),
      ),
    );

    expect(tables.comparisonOffer.rows).toHaveLength(0);

    const { audits } = await expectSuccess<{ audits: ComparisonOfferAuditDto[] }>(
      await auditRoute(
        apiRequest(`/api/admin/comparison-offers/${offer.id}`, { token: admin.token }),
        context(offer.id),
      ),
    );

    const removal = audits.find((entry) => entry.action === 'DELETE');

    expect(removal?.before?.serviceName).toBe('Netflix');
    expect(removal?.after).toBeNull();
  });

  it('renvoie NOT_FOUND pour une offre inexistante', async () => {
    const response = await patchRoute(
      apiRequest('/api/admin/comparison-offers/off_inconnue', {
        method: 'PATCH',
        token: admin.token,
        body: { serviceName: 'Autre' },
      }),
      context('off_inconnue'),
    );

    expect(await expectErrorCode(response)).toBe('NOT_FOUND');
  });

  it('filtre la liste par pays', async () => {
    await createOffer();
    await createRoute(
      apiRequest('/api/admin/comparison-offers', {
        method: 'POST',
        token: admin.token,
        body: { ...VALID_OFFER, country: 'US', serviceName: 'Netflix US' },
      }),
    );

    const { offers } = await expectSuccess<{ offers: ComparisonOfferDto[] }>(
      await listRoute(
        apiRequest('/api/admin/comparison-offers?country=US', { token: admin.token }),
      ),
    );

    expect(offers.map((offer) => offer.serviceName)).toEqual(['Netflix US']);
  });

  it('refuse une offre dont la date de vérification est dans le futur', async () => {
    const response = await createRoute(
      apiRequest('/api/admin/comparison-offers', {
        method: 'POST',
        token: admin.token,
        body: {
          ...VALID_OFFER,
          // Datée du futur, l'offre paraîtrait fraîche sans avoir été vérifiée.
          lastVerifiedAt: '2099-01-01T00:00:00.000Z',
          nextCheckAt: '2099-02-01T00:00:00.000Z',
        },
      }),
    );

    expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
    expect(tables.comparisonOffer.rows).toHaveLength(0);
    expect(tables.comparisonOfferAudit.rows).toHaveLength(0);
  });

  it('refuse une revérification ou une correction datée du futur', async () => {
    const offer = await createOffer();

    const verify = await verifyRoute(
      apiRequest(`/api/admin/comparison-offers/${offer.id}/verify`, {
        method: 'POST',
        token: admin.token,
        body: { verifiedAt: '2099-01-01T00:00:00.000Z', nextCheckAt: '2099-02-01T00:00:00.000Z' },
      }),
      context(offer.id),
    );
    const patch = await patchRoute(
      apiRequest(`/api/admin/comparison-offers/${offer.id}`, {
        method: 'PATCH',
        token: admin.token,
        body: {
          lastVerifiedAt: '2099-01-01T00:00:00.000Z',
          nextCheckAt: '2099-02-01T00:00:00.000Z',
        },
      }),
      context(offer.id),
    );

    expect(await expectErrorCode(verify)).toBe('VALIDATION_ERROR');
    expect(await expectErrorCode(patch)).toBe('VALIDATION_ERROR');
    expect(tables.comparisonOfferAudit.rows).toHaveLength(1);
  });

  it('écrit chaque modification et sa trace dans une même transaction', async () => {
    const transaction = vi.spyOn(prisma, '$transaction');

    try {
      const offer = await createOffer();

      expect(transaction).toHaveBeenCalledTimes(1);

      await patchRoute(
        apiRequest(`/api/admin/comparison-offers/${offer.id}`, {
          method: 'PATCH',
          token: admin.token,
          body: { serviceName: 'Netflix Standard' },
        }),
        context(offer.id),
      );
      await verifyRoute(
        apiRequest(`/api/admin/comparison-offers/${offer.id}/verify`, {
          method: 'POST',
          token: admin.token,
          body: { verifiedAt: '2026-06-20T00:00:00.000Z', nextCheckAt: '2026-07-20T00:00:00.000Z' },
        }),
        context(offer.id),
      );
      await deleteRoute(
        apiRequest(`/api/admin/comparison-offers/${offer.id}`, {
          method: 'DELETE',
          token: admin.token,
        }),
        context(offer.id),
      );

      expect(transaction).toHaveBeenCalledTimes(4);
      expect(
        (tables.comparisonOfferAudit.rows as Array<{ action: string }>).map((row) => row.action),
      ).toEqual(['CREATE', 'UPDATE', 'VERIFY', 'DELETE']);
    } finally {
      transaction.mockRestore();
    }
  });
});
