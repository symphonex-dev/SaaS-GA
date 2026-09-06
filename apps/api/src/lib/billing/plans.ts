import type { StorePlatform, StoreProduct } from '@subscription-manager/shared';

import { getServerEnv } from '@/lib/env/server';

/**
 * Correspondance identifiant de produit → formule
 * (`specs/paiement-in-app.md` §3).
 *
 * Les identifiants viennent de la configuration serveur, jamais du client :
 * un `productId` inconnu n'accorde rien. C'est la première barrière du flux
 * d'achat — le client peut prétendre ce qu'il veut, seuls quatre produits
 * existent.
 */
export function productCatalog(store: StorePlatform): ReadonlyMap<string, StoreProduct> {
  const env = getServerEnv();

  const entries: Array<[string, StoreProduct]> =
    store === 'GOOGLE_PLAY'
      ? [
          [env.GOOGLE_PLAY_PLUS_MONTHLY_PRODUCT_ID, { plan: 'PLUS', billingCycle: 'MONTHLY' }],
          [env.GOOGLE_PLAY_PLUS_YEARLY_PRODUCT_ID, { plan: 'PLUS', billingCycle: 'YEARLY' }],
        ]
      : [
          [env.APP_STORE_PLUS_MONTHLY_PRODUCT_ID, { plan: 'PLUS', billingCycle: 'MONTHLY' }],
          [env.APP_STORE_PLUS_YEARLY_PRODUCT_ID, { plan: 'PLUS', billingCycle: 'YEARLY' }],
        ];

  // Un identifiant non configuré est ignoré : sans lui, la chaîne vide
  // deviendrait un produit valide accordant Plus.
  return new Map(entries.filter(([productId]) => productId.length > 0));
}

/** `null` si le produit n'est pas commercialisé : aucun plan n'est accordé. */
export function resolveProduct(store: StorePlatform, productId: string): StoreProduct | null {
  return productCatalog(store).get(productId) ?? null;
}
