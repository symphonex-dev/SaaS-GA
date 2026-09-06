import { describe, expect, it } from 'vitest';

import {
  AI_TASK_ENDPOINTS,
  EXPENSE_WRITE_INVALIDATIONS,
  PURCHASE_INVALIDATIONS,
  SAVINGS_WRITE_INVALIDATIONS,
  aiQuotaCall,
  aiTaskCall,
  createExpenseCall,
  createSavingsGoalCall,
  deleteExpenseCall,
  deleteSavingsGoalCall,
  readExpenseCall,
  updateExpenseCall,
  updateSavingsGoalCall,
  verifyPurchaseCall,
} from '../lib/api-endpoints';
import { queryKeys } from '../lib/query-client';

/**
 * Contrat d'API du mobile (mission §5, §8, §9, §10, §12 et §22).
 *
 * Ces tests figent ce que le client a le droit d'envoyer. Ils échouent si
 * quelqu'un ajoute un champ que le serveur est seul à décider — plan, statut,
 * source d'une dépense — ou une quatrième route IA.
 */
const amount = { minorUnits: '1349', currency: 'EUR' } as const;

describe('transactions — saisie manuelle', () => {
  it('crée une transaction en POST sur /api/expenses', () => {
    const call = createExpenseCall({
      merchantRaw: 'Boulangerie',
      merchantNormalized: 'Boulangerie',
      merchantOverride: null,
      amount,
      date: '2026-09-05T00:00:00.000Z',
      frequency: 'ONCE',
      category: 'FOOD',
      paymentMethod: null,
      notes: null,
      status: 'ACTIVE',
      source: 'MANUAL',
      importBatchId: null,
    });

    expect(call.path).toBe('/api/expenses');
    expect(call.options.method).toBe('POST');
  });

  it('lit une transaction unitaire en GET', () => {
    expect(readExpenseCall('exp_1')).toEqual({
      path: '/api/expenses/exp_1',
      options: { method: 'GET' },
    });
  });

  it('corrige une transaction en PATCH, via merchantOverride uniquement', () => {
    const call = updateExpenseCall('exp_1', {
      merchantOverride: 'Netflix',
      amount,
      date: '2026-09-05T00:00:00.000Z',
    });

    expect(call.path).toBe('/api/expenses/exp_1');
    expect(call.options.method).toBe('PATCH');

    const body = JSON.stringify(call.options.body);

    // Le libellé d'origine du relevé n'est jamais réécrit par le client
    // (`specs/import-releves.md` §9).
    expect(body).not.toContain('merchantRaw');
    expect(body).not.toContain('merchantNormalized');
  });

  it('supprime une transaction en DELETE, sans corps', () => {
    expect(deleteExpenseCall('exp_1')).toEqual({
      path: '/api/expenses/exp_1',
      options: { method: 'DELETE' },
    });
  });

  it('ne laisse jamais le client fixer la source d’une correction', () => {
    const call = updateExpenseCall('exp_1', { amount });

    expect(JSON.stringify(call.options.body)).not.toContain('source');
  });

  it('invalide les transactions, les récurrences, le dashboard et les économies', () => {
    expect([...EXPENSE_WRITE_INVALIDATIONS]).toEqual([
      queryKeys.expenses,
      queryKeys.subscriptions,
      queryKeys.dashboard,
      queryKeys.savings,
    ]);
  });
});

describe('objectifs d’épargne', () => {
  it('crée un objectif en POST sur /api/savings', () => {
    const call = createSavingsGoalCall({ targetAmount: amount });

    expect(call.path).toBe('/api/savings');
    expect(call.options.method).toBe('POST');
    expect(call.options.body).toEqual({ targetAmount: amount });
  });

  it('confirme une économie en PATCH, avec le montant déclaré par l’utilisateur', () => {
    const call = updateSavingsGoalCall('goal_1', { achievedAmount: amount });

    expect(call).toEqual({
      path: '/api/savings/goal_1',
      options: { method: 'PATCH', body: { achievedAmount: amount } },
    });
  });

  it('ne transporte jamais de statut calculé par le client', () => {
    const call = updateSavingsGoalCall('goal_1', { achievedAmount: amount });

    // `REACHED` est dérivé côté serveur du montant atteint.
    expect(JSON.stringify(call.options.body)).not.toContain('REACHED');
  });

  it('supprime un objectif en DELETE', () => {
    expect(deleteSavingsGoalCall('goal_1')).toEqual({
      path: '/api/savings/goal_1',
      options: { method: 'DELETE' },
    });
  });

  it('invalide les objectifs et le dashboard', () => {
    expect([...SAVINGS_WRITE_INVALIDATIONS]).toEqual([queryKeys.savings, queryKeys.dashboard]);
  });
});

describe('assistant IA borné', () => {
  it('n’expose que les trois usages autorisés', () => {
    expect(Object.keys(AI_TASK_ENDPOINTS).sort()).toEqual([
      'EXPLAIN_INCREASE',
      'MONTHLY_SUMMARY',
      'RECOMMENDATION',
    ]);
  });

  it('appelle exactement les trois routes du serveur', () => {
    expect(aiTaskCall('MONTHLY_SUMMARY').path).toBe('/api/ai/summary');
    expect(aiTaskCall('EXPLAIN_INCREASE').path).toBe('/api/ai/explain-increase');
    expect(aiTaskCall('RECOMMENDATION').path).toBe('/api/ai/recommendation');
  });

  it('n’envoie aucun corps : pas de question libre, pas de contexte client', () => {
    for (const task of ['MONTHLY_SUMMARY', 'EXPLAIN_INCREASE', 'RECOMMENDATION'] as const) {
      const call = aiTaskCall(task);

      expect(call.options.method).toBe('POST');
      expect(call.options.body).toBeUndefined();
      expect(call.options.formData).toBeUndefined();
    }
  });

  it('lit le quota en GET, sans consommer de crédit', () => {
    expect(aiQuotaCall()).toEqual({ path: '/api/ai/summary', options: { method: 'GET' } });
  });

  it('n’appelle jamais un fournisseur d’IA directement', () => {
    for (const path of Object.values(AI_TASK_ENDPOINTS)) {
      expect(path.startsWith('/api/')).toBe(true);
    }
  });
});

describe('vérification d’achat', () => {
  it('n’envoie que la preuve d’achat Google Play', () => {
    const call = verifyPurchaseCall({
      store: 'GOOGLE_PLAY',
      productId: 'plus_monthly',
      purchaseToken: 'token-du-store',
    });

    expect(call.path).toBe('/api/billing/purchase/verify');
    expect(call.options.method).toBe('POST');
    expect(call.options.body).toEqual({
      store: 'GOOGLE_PLAY',
      productId: 'plus_monthly',
      purchaseToken: 'token-du-store',
    });
  });

  it('n’envoie ni plan, ni statut, ni date de fin de période', () => {
    const body = JSON.stringify(
      verifyPurchaseCall({
        store: 'APP_STORE',
        productId: 'plus_yearly',
        transactionId: 'txn-1',
      }).options.body,
    );

    for (const forbidden of ['plan', 'status', 'currentPeriodEnd', 'entitlements', 'PLUS']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('relit l’abonnement, la session, le compte et le dashboard après vérification', () => {
    expect([...PURCHASE_INVALIDATIONS]).toEqual([
      queryKeys.billing,
      queryKeys.session,
      queryKeys.account,
      queryKeys.dashboard,
    ]);
  });
});
