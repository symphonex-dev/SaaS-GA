import type { AuthenticatedSessionDto, SubscriptionDto } from '@subscription-manager/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as subscriptionRoute } from '@/app/api/billing/subscription/route';
import { POST as verifyRoute } from '@/app/api/billing/purchase/verify/route';
import { PATCH as preferencesRoute } from '@/app/api/account/preferences/route';
import { resetServerEnvCache } from '@/lib/env/server';
import { resetStoreClientsForTesting, setStoreClientForTesting } from '@/lib/billing/store-client';
import { resetRateLimits } from '@/lib/security/rate-limit';
import type { Entitlements } from '@/server/entitlements/entitlements';

import { fakeState, fakeStoreClient } from '../helpers/billing';
import { createUserWithSession } from '../helpers/factories';
import { apiRequest, expectErrorCode, expectSuccess } from '../helpers/http';
import { resetDatabase, tables } from '../helpers/prisma-mock';

/**
 * Vérification d'achat côté serveur (`specs/paiement-in-app.md` §4, §10).
 *
 * Le double de store remplace uniquement l'appel HTTP à Google/Apple : tout le
 * code de vérification, de résolution de produit et d'écriture est celui de
 * production.
 */
const PLUS_MONTHLY = 'plus_monthly';
const PLUS_YEARLY = 'plus_yearly';
const EXPIRES_AT = new Date('2026-09-15T12:00:00.000Z');

describe('vérification d’achat', () => {
  let session: AuthenticatedSessionDto;
  let other: AuthenticatedSessionDto;

  beforeEach(async () => {
    resetDatabase();
    resetRateLimits();
    resetStoreClientsForTesting();

    process.env['GOOGLE_PLAY_PLUS_MONTHLY_PRODUCT_ID'] = PLUS_MONTHLY;
    process.env['GOOGLE_PLAY_PLUS_YEARLY_PRODUCT_ID'] = PLUS_YEARLY;
    process.env['APP_STORE_PLUS_MONTHLY_PRODUCT_ID'] = PLUS_MONTHLY;
    process.env['APP_STORE_PLUS_YEARLY_PRODUCT_ID'] = PLUS_YEARLY;
    resetServerEnvCache();

    session = await createUserWithSession({ email: 'acheteur@example.com' });
    other = await createUserWithSession({ email: 'voisin@example.com' });
  });

  afterEach(() => {
    resetStoreClientsForTesting();

    for (const key of [
      'GOOGLE_PLAY_PLUS_MONTHLY_PRODUCT_ID',
      'GOOGLE_PLAY_PLUS_YEARLY_PRODUCT_ID',
      'APP_STORE_PLUS_MONTHLY_PRODUCT_ID',
      'APP_STORE_PLUS_YEARLY_PRODUCT_ID',
    ]) {
      delete process.env[key];
    }

    resetServerEnvCache();
  });

  function verify(body: unknown, token: string): Promise<Response> {
    return verifyRoute(apiRequest('/api/billing/purchase/verify', { method: 'POST', token, body }));
  }

  it('exige une session valide', async () => {
    const response = await verify(
      { store: 'GOOGLE_PLAY', productId: PLUS_MONTHLY, purchaseToken: 'tok' },
      '',
    );

    expect(await expectErrorCode(response)).toBe('AUTH_UNAUTHORIZED');
  });

  it('vérifie un achat Plus mensuel sur Google Play', async () => {
    setStoreClientForTesting(
      'GOOGLE_PLAY',
      fakeStoreClient(
        'GOOGLE_PLAY',
        fakeState('GOOGLE_PLAY', { productId: PLUS_MONTHLY, expiresAt: EXPIRES_AT }),
      ),
    );

    const { subscription } = await expectSuccess<{ subscription: SubscriptionDto }>(
      await verify(
        { store: 'GOOGLE_PLAY', productId: PLUS_MONTHLY, purchaseToken: 'tok_android' },
        session.token,
      ),
    );

    expect(subscription.plan).toBe('PLUS');
    expect(subscription.status).toBe('ACTIVE');
    expect(subscription.billingCycle).toBe('MONTHLY');
    expect(subscription.store).toBe('GOOGLE_PLAY');
    expect(subscription.currentPeriodEnd).toBe(EXPIRES_AT.toISOString());
    expect(subscription.cancelAtPeriodEnd).toBe(false);
  });

  it('vérifie un achat Plus annuel sur l’App Store', async () => {
    setStoreClientForTesting(
      'APP_STORE',
      fakeStoreClient(
        'APP_STORE',
        fakeState('APP_STORE', { productId: PLUS_YEARLY, expiresAt: EXPIRES_AT }),
      ),
    );

    const { subscription } = await expectSuccess<{ subscription: SubscriptionDto }>(
      await verify(
        { store: 'APP_STORE', productId: PLUS_YEARLY, transactionId: 'txn_ios' },
        session.token,
      ),
    );

    expect(subscription.plan).toBe('PLUS');
    expect(subscription.billingCycle).toBe('YEARLY');
    expect(subscription.store).toBe('APP_STORE');
  });

  it('transmet bien la preuve d’achat au store, sans rien en déduire', async () => {
    const client = fakeStoreClient(
      'GOOGLE_PLAY',
      fakeState('GOOGLE_PLAY', { productId: PLUS_MONTHLY, expiresAt: EXPIRES_AT }),
    );

    setStoreClientForTesting('GOOGLE_PLAY', client);

    await verify(
      { store: 'GOOGLE_PLAY', productId: PLUS_MONTHLY, purchaseToken: 'tok_android' },
      session.token,
    );

    expect(client.calls).toEqual([{ purchaseToken: 'tok_android' }]);
  });

  it('refuse un produit absent de la configuration serveur', async () => {
    setStoreClientForTesting(
      'GOOGLE_PLAY',
      fakeStoreClient(
        'GOOGLE_PLAY',
        fakeState('GOOGLE_PLAY', { productId: 'plus_lifetime', expiresAt: EXPIRES_AT }),
      ),
    );

    const response = await verify(
      { store: 'GOOGLE_PLAY', productId: 'plus_lifetime', purchaseToken: 'tok' },
      session.token,
    );

    expect(await expectErrorCode(response)).toBe('BILLING_PRODUCT_UNKNOWN');
    expect(tables.subscription.rows).toHaveLength(0);
  });

  it('refuse un achat que le store ne confirme pas', async () => {
    setStoreClientForTesting('GOOGLE_PLAY', fakeStoreClient('GOOGLE_PLAY', null));

    const response = await verify(
      { store: 'GOOGLE_PLAY', productId: PLUS_MONTHLY, purchaseToken: 'tok_invente' },
      session.token,
    );

    expect(await expectErrorCode(response)).toBe('BILLING_VERIFICATION_FAILED');
    expect(tables.subscription.rows).toHaveLength(0);
  });

  it('refuse un achat dont le produit ne correspond pas à celui annoncé', async () => {
    // Le client annonce l'offre annuelle, le store confirme la mensuelle.
    setStoreClientForTesting(
      'GOOGLE_PLAY',
      fakeStoreClient(
        'GOOGLE_PLAY',
        fakeState('GOOGLE_PLAY', { productId: PLUS_MONTHLY, expiresAt: EXPIRES_AT }),
      ),
    );

    const response = await verify(
      { store: 'GOOGLE_PLAY', productId: PLUS_YEARLY, purchaseToken: 'tok' },
      session.token,
    );

    expect(await expectErrorCode(response)).toBe('BILLING_VERIFICATION_FAILED');
  });

  it('refuse un achat inactif ou déjà expiré chez le store', async () => {
    setStoreClientForTesting(
      'GOOGLE_PLAY',
      fakeStoreClient(
        'GOOGLE_PLAY',
        fakeState('GOOGLE_PLAY', {
          productId: PLUS_MONTHLY,
          expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        }),
      ),
    );

    const response = await verify(
      { store: 'GOOGLE_PLAY', productId: PLUS_MONTHLY, purchaseToken: 'tok' },
      session.token,
    );

    expect(await expectErrorCode(response)).toBe('BILLING_VERIFICATION_FAILED');
  });

  it('refuse de rattacher un même achat à deux comptes', async () => {
    setStoreClientForTesting(
      'GOOGLE_PLAY',
      fakeStoreClient(
        'GOOGLE_PLAY',
        fakeState('GOOGLE_PLAY', {
          productId: PLUS_MONTHLY,
          expiresAt: EXPIRES_AT,
          originalTransactionId: 'orig_partage',
        }),
      ),
    );

    await expectSuccess<{ subscription: SubscriptionDto }>(
      await verify(
        { store: 'GOOGLE_PLAY', productId: PLUS_MONTHLY, purchaseToken: 'tok' },
        session.token,
      ),
    );

    const response = await verify(
      { store: 'GOOGLE_PLAY', productId: PLUS_MONTHLY, purchaseToken: 'tok' },
      other.token,
    );

    expect(await expectErrorCode(response)).toBe('BILLING_PURCHASE_ALREADY_LINKED');
  });

  it('reste sans effet quand le store n’est pas configuré', async () => {
    // Aucun `setStoreClientForTesting` : les identifiants réels sont absents,
    // donc aucun client n'est constructible.
    const response = await verify(
      { store: 'GOOGLE_PLAY', productId: PLUS_MONTHLY, purchaseToken: 'tok' },
      session.token,
    );

    expect(await expectErrorCode(response)).toBe('BILLING_STORE_UNAVAILABLE');
    expect(tables.subscription.rows).toHaveLength(0);
  });

  it('refuse une preuve d’achat incomplète', async () => {
    const sansJeton = await verify(
      { store: 'GOOGLE_PLAY', productId: PLUS_MONTHLY },
      session.token,
    );

    expect(await expectErrorCode(sansJeton)).toBe('VALIDATION_ERROR');

    const sansTransaction = await verify(
      { store: 'APP_STORE', productId: PLUS_MONTHLY },
      session.token,
    );

    expect(await expectErrorCode(sansTransaction)).toBe('VALIDATION_ERROR');
  });

  it('ignore tout plan ou toute échéance envoyés par le client', async () => {
    setStoreClientForTesting(
      'GOOGLE_PLAY',
      fakeStoreClient(
        'GOOGLE_PLAY',
        fakeState('GOOGLE_PLAY', { productId: PLUS_MONTHLY, expiresAt: EXPIRES_AT }),
      ),
    );

    const { subscription } = await expectSuccess<{ subscription: SubscriptionDto }>(
      await verify(
        {
          store: 'GOOGLE_PLAY',
          productId: PLUS_MONTHLY,
          purchaseToken: 'tok',
          // Champs hostiles : le schéma ne les connaît pas, le service non plus.
          plan: 'PRO',
          status: 'ACTIVE',
          currentPeriodEnd: '2099-01-01T00:00:00.000Z',
        },
        session.token,
      ),
    );

    expect(subscription.plan).toBe('PLUS');
    expect(subscription.currentPeriodEnd).toBe(EXPIRES_AT.toISOString());
  });

  it('n’expose aucune route permettant de changer son plan directement', async () => {
    // La seule route de modification de compte est celle des préférences :
    // elle ne connaît ni plan, ni statut, ni échéance.
    const response = await preferencesRoute(
      apiRequest('/api/account/preferences', {
        method: 'PATCH',
        token: session.token,
        body: { language: 'fr', plan: 'PLUS', tier: 'PLUS' },
      }),
    );

    // Le schéma des préférences est strict : les champs inconnus font échouer
    // la requête entière, plutôt que d'être silencieusement ignorés.
    expect(await expectErrorCode(response)).toBe('VALIDATION_ERROR');
    expect(tables.subscription.rows).toHaveLength(0);

    const user = tables.user.rows.find((row) => row['id'] === session.user.id);

    expect(user?.['tier']).toBe('FREE');
  });

  it('expose l’offre en vigueur et ses droits, résolus côté serveur', async () => {
    setStoreClientForTesting(
      'GOOGLE_PLAY',
      fakeStoreClient(
        'GOOGLE_PLAY',
        fakeState('GOOGLE_PLAY', { productId: PLUS_MONTHLY, expiresAt: EXPIRES_AT }),
      ),
    );

    await verify(
      { store: 'GOOGLE_PLAY', productId: PLUS_MONTHLY, purchaseToken: 'tok' },
      session.token,
    );

    const state = await expectSuccess<{
      subscription: SubscriptionDto;
      plan: string;
      entitlements: Entitlements;
    }>(await subscriptionRoute(apiRequest('/api/billing/subscription', { token: session.token })));

    expect(state.plan).toBe('PLUS');
    expect(state.entitlements.pdfImportEnabled).toBe(true);
    // Aucun identifiant de transaction n'est exposé au client.
    expect(JSON.stringify(state.subscription)).not.toContain('orig_');
    expect(JSON.stringify(state.subscription)).not.toContain('txn_');
  });

  it('renvoie l’offre Free pour un compte sans abonnement', async () => {
    const state = await expectSuccess<{ subscription: SubscriptionDto; plan: string }>(
      await subscriptionRoute(apiRequest('/api/billing/subscription', { token: session.token })),
    );

    expect(state.plan).toBe('FREE');
    expect(state.subscription.plan).toBe('FREE');
    expect(state.subscription.store).toBeNull();
  });
});
