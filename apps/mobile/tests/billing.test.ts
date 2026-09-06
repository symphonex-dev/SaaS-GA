import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Platform } from 'react-native';

import {
  loadNativePurchases,
  plusProductIds,
  resetNativePurchasesCache,
  storeForPlatform,
  toVerifyPurchaseInput,
  type NativePurchase,
  type NativePurchaseError,
  type NativePurchasesModule,
} from '../lib/native-purchases';
import { finishPurchase, purchaseProduct } from '../lib/purchase-flow';

/**
 * Achat in-app côté mobile (`specs/paiement-in-app.md` §4).
 *
 * ⚠️ Aucun test ne fabrique un achat que le serveur accepterait. Ce qui est
 * vérifié ici est strictement le **chemin d'intégration** : le module natif est
 * isolé, son absence est un état déclaré (jamais un plantage), seule la preuve
 * délivrée par le store est transmise, et l'acquittement n'a lieu qu'après la
 * vérification serveur. L'octroi du plan reste une décision du serveur après
 * vérification auprès de l'API du store (§1) — rien ici ne peut la contourner.
 */
const originalEnv = { ...process.env };

beforeEach(() => {
  resetNativePurchasesCache();
  Platform.OS = 'android';
  process.env['EXPO_PUBLIC_PLUS_MONTHLY_PRODUCT_ID'] = 'plus_monthly';
  process.env['EXPO_PUBLIC_PLUS_YEARLY_PRODUCT_ID'] = 'plus_yearly';
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetNativePurchasesCache();
});

describe('capacité native', () => {
  it('associe chaque plateforme à son store', () => {
    expect(storeForPlatform('android')).toBe('GOOGLE_PLAY');
    expect(storeForPlatform('ios')).toBe('APP_STORE');
    expect(storeForPlatform('web')).toBeNull();
  });

  it('déclare la plateforme non supportée plutôt que de planter', () => {
    Platform.OS = 'web';

    expect(loadNativePurchases()).toEqual({ available: false, reason: 'UNSUPPORTED_PLATFORM' });
  });

  it("déclare l'achat non configuré quand aucun produit n'est déclaré", () => {
    delete process.env['EXPO_PUBLIC_PLUS_MONTHLY_PRODUCT_ID'];
    delete process.env['EXPO_PUBLIC_PLUS_YEARLY_PRODUCT_ID'];

    expect(loadNativePurchases()).toEqual({ available: false, reason: 'NOT_CONFIGURED' });
  });

  it("détecte l'absence du module natif sans lever (cas Expo Go)", () => {
    // Le double de `expo-iap` n'expose aucune des fonctions attendues : c'est
    // exactement ce que voit l'application dans Expo Go.
    expect(() => loadNativePurchases()).not.toThrow();
    expect(loadNativePurchases()).toEqual({
      available: false,
      reason: 'NATIVE_MODULE_UNAVAILABLE',
    });
  });

  it("n'expose aucun identifiant de produit tant qu'il n'est pas configuré", () => {
    delete process.env['EXPO_PUBLIC_PLUS_MONTHLY_PRODUCT_ID'];
    delete process.env['EXPO_PUBLIC_PLUS_YEARLY_PRODUCT_ID'];

    expect(plusProductIds()).toEqual({ monthly: null, yearly: null });
  });

  it('lit les identifiants de produits depuis des variables publiques', () => {
    expect(plusProductIds()).toEqual({ monthly: 'plus_monthly', yearly: 'plus_yearly' });
  });
});

describe('extraction de la preuve d’achat', () => {
  it('retient le jeton Google Play', () => {
    expect(
      toVerifyPurchaseInput('GOOGLE_PLAY', 'plus_monthly', { purchaseToken: 'token-du-store' }),
    ).toEqual({ store: 'GOOGLE_PLAY', productId: 'plus_monthly', purchaseToken: 'token-du-store' });
  });

  it('retient l’identifiant de transaction StoreKit', () => {
    expect(toVerifyPurchaseInput('APP_STORE', 'plus_yearly', { transactionId: 'txn-1' })).toEqual({
      store: 'APP_STORE',
      productId: 'plus_yearly',
      transactionId: 'txn-1',
    });
  });

  it('accepte `id` comme identifiant de transaction iOS', () => {
    expect(toVerifyPurchaseInput('APP_STORE', 'plus_yearly', { id: 'txn-2' })).toEqual({
      store: 'APP_STORE',
      productId: 'plus_yearly',
      transactionId: 'txn-2',
    });
  });

  it('refuse une preuve absente plutôt que de supposer un achat', () => {
    expect(toVerifyPurchaseInput('GOOGLE_PLAY', 'plus_monthly', {})).toBeNull();
    expect(toVerifyPurchaseInput('GOOGLE_PLAY', 'plus_monthly', { purchaseToken: '' })).toBeNull();
    expect(
      toVerifyPurchaseInput('APP_STORE', 'plus_yearly', { transactionId: null, id: null }),
    ).toBeNull();
  });

  it('ne transporte jamais autre chose que la preuve', () => {
    const input = toVerifyPurchaseInput('GOOGLE_PLAY', 'plus_monthly', {
      purchaseToken: 'token-du-store',
    });

    expect(Object.keys(input ?? {}).sort()).toEqual(['productId', 'purchaseToken', 'store']);
  });
});

/**
 * Double du SDK : il ne prouve rien sur un vrai achat, il exerce le parcours
 * **événementiel** de `expo-iap` (la preuve arrive par un écouteur, pas par la
 * valeur de retour de `requestPurchase`).
 */
function fakeIap(
  options: {
    purchase?: NativePurchase | null;
    error?: NativePurchaseError | null;
    products?: { id: string }[];
    requestRejects?: unknown;
    finishRejects?: boolean;
  } = {},
) {
  const listeners: {
    updated?: (p: NativePurchase) => void;
    failed?: (e: NativePurchaseError) => void;
  } = {};
  const state = { removed: 0, finished: [] as NativePurchase[] };

  const module = {
    initConnection: vi.fn(() => Promise.resolve(true)),
    endConnection: vi.fn(() => Promise.resolve(true)),
    fetchProducts: vi.fn(() =>
      Promise.resolve(
        options.products ?? [
          {
            id: 'plus_monthly',
            subscriptionOfferDetailsAndroid: [{ sku: 'plus_monthly', offerToken: 'offer-1' }],
          },
        ],
      ),
    ),
    requestPurchase: vi.fn(() => {
      if (options.requestRejects !== undefined) {
        return Promise.reject(
          options.requestRejects instanceof Error
            ? options.requestRejects
            : new Error('rejet du store'),
        );
      }

      // Le store répond par un événement, jamais par la valeur de retour.
      setTimeout(() => {
        if (options.error != null) {
          listeners.failed?.(options.error);
        } else if (options.purchase !== undefined && options.purchase !== null) {
          listeners.updated?.(options.purchase);
        }
      }, 0);

      return Promise.resolve(null);
    }),
    finishTransaction: vi.fn((args: { purchase: NativePurchase }) => {
      if (options.finishRejects === true) {
        return Promise.reject(new Error('finish failed'));
      }

      state.finished.push(args.purchase);

      return Promise.resolve(true);
    }),
    purchaseUpdatedListener: vi.fn((listener: (p: NativePurchase) => void) => {
      listeners.updated = listener;

      return {
        remove: () => {
          state.removed += 1;
        },
      };
    }),
    purchaseErrorListener: vi.fn((listener: (e: NativePurchaseError) => void) => {
      listeners.failed = listener;

      return {
        remove: () => {
          state.removed += 1;
        },
      };
    }),
  };

  // `state` est attaché tel quel : `Object.assign` copierait la valeur d'un
  // accesseur au moment de l'appel, pas sa lecture différée.
  return Object.assign(module, { state });
}

/** Le double satisfait bien le contrat consommé par le parcours d'achat. */
function asModule(iap: ReturnType<typeof fakeIap>): NativePurchasesModule {
  return iap;
}

describe('parcours d’achat', () => {
  it('ne remonte que la preuve du store, jamais un plan', async () => {
    const iap = fakeIap({
      purchase: { productId: 'plus_monthly', purchaseToken: 'token-du-store' },
    });

    const outcome = await purchaseProduct('plus_monthly', asModule(iap));

    expect(outcome).toMatchObject({
      status: 'verified',
      input: { store: 'GOOGLE_PLAY', productId: 'plus_monthly', purchaseToken: 'token-du-store' },
    });
  });

  it('transmet le jeton d’offre Google Play, requis pour un abonnement', async () => {
    const iap = fakeIap({ purchase: { purchaseToken: 'token-du-store' } });

    await purchaseProduct('plus_monthly', asModule(iap));

    expect(iap.requestPurchase).toHaveBeenCalledWith({
      request: {
        apple: { sku: 'plus_monthly' },
        google: {
          skus: ['plus_monthly'],
          subscriptionOffers: [{ sku: 'plus_monthly', offerToken: 'offer-1' }],
        },
      },
      type: 'subs',
    });
  });

  it('échoue proprement quand le store ne propose pas le produit', async () => {
    const iap = fakeIap({ products: [] });

    expect(await purchaseProduct('plus_monthly', asModule(iap))).toEqual({
      status: 'failed',
      reason: 'NO_OFFERING',
    });
    // Aucun achat n'a été demandé : on ne tente pas un produit inexistant.
    expect(iap.requestPurchase).not.toHaveBeenCalled();
  });

  it('échoue quand le store ne renvoie aucune preuve — jamais un faux succès', async () => {
    const iap = fakeIap({ purchase: { productId: 'plus_monthly' } });

    expect(await purchaseProduct('plus_monthly', asModule(iap))).toEqual({
      status: 'failed',
      reason: 'NO_PROOF',
    });
  });

  it('distingue une annulation utilisateur d’une panne', async () => {
    const cancelled = await purchaseProduct(
      'plus_monthly',
      asModule(fakeIap({ error: { code: 'E_USER_CANCELLED' } })),
    );

    expect(cancelled).toEqual({ status: 'cancelled' });

    const failed = await purchaseProduct(
      'plus_monthly',
      asModule(fakeIap({ error: { code: 'E_SERVICE_ERROR' } })),
    );

    expect(failed).toEqual({ status: 'failed', reason: 'STORE_ERROR' });
  });

  it('traite un rejet synchrone de `requestPurchase` comme une panne du store', async () => {
    const iap = fakeIap({ requestRejects: new Error('E_NOT_PREPARED') });

    expect(await purchaseProduct('plus_monthly', asModule(iap))).toEqual({
      status: 'failed',
      reason: 'STORE_ERROR',
    });
  });

  it('abandonne l’attente au bout du délai, sans prétendre à un échec d’achat', async () => {
    // Aucun événement n'est émis : le store ne répond pas.
    const iap = fakeIap({ purchase: null });

    expect(await purchaseProduct('plus_monthly', iap, 10)).toEqual({
      status: 'failed',
      reason: 'TIMEOUT',
    });
  });

  it('retire toujours ses écouteurs, quel que soit le résultat', async () => {
    const iap = fakeIap({ purchase: { purchaseToken: 'token-du-store' } });

    await purchaseProduct('plus_monthly', asModule(iap));

    expect(iap.state.removed).toBe(2);
  });

  it('renvoie « indisponible » plutôt que de lever quand le module natif manque', async () => {
    await expect(purchaseProduct('plus_monthly')).resolves.toEqual({
      status: 'unavailable',
      reason: 'NATIVE_MODULE_UNAVAILABLE',
    });
  });

  it('renvoie « indisponible » sur une plateforme sans boutique', async () => {
    Platform.OS = 'web';

    await expect(purchaseProduct('plus_monthly')).resolves.toEqual({
      status: 'unavailable',
      reason: 'UNSUPPORTED_PLATFORM',
    });
  });
});

describe('acquittement de la transaction', () => {
  it('acquitte un abonnement sans le consommer', async () => {
    const iap = fakeIap();
    const purchase: NativePurchase = { purchaseToken: 'token-du-store' };

    expect(await finishPurchase(purchase, asModule(iap))).toBe(true);
    expect(iap.finishTransaction).toHaveBeenCalledWith({ purchase, isConsumable: false });
  });

  it('ne lève pas quand l’acquittement échoue : l’achat reste vérifié', async () => {
    const iap = fakeIap({ finishRejects: true });

    await expect(finishPurchase({ purchaseToken: 'token' }, asModule(iap))).resolves.toBe(false);
  });

  it('renvoie false quand le module natif est absent', async () => {
    await expect(finishPurchase({ purchaseToken: 'token' })).resolves.toBe(false);
  });
});
