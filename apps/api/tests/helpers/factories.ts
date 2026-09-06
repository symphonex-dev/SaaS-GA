import type { AuthenticatedSessionDto, RegisterInput } from '@subscription-manager/shared';

import { authService } from '@/server/services/auth.service';

import { tables } from './prisma-mock';

/**
 * Fabriques de données de test. Elles passent par le service réel : les
 * utilisateurs de test ont donc un mot de passe réellement haché en Argon2id,
 * comme en production.
 */
export const VALID_PASSWORD = 'MotDePasseTresLong2026';

export function registerInput(overrides: Partial<RegisterInput> = {}): RegisterInput {
  return {
    email: 'utilisateur@example.com',
    password: VALID_PASSWORD,
    language: 'fr',
    country: 'FR',
    currency: 'EUR',
    ...overrides,
  };
}

export async function createUserWithSession(
  overrides: Partial<RegisterInput> = {},
): Promise<AuthenticatedSessionDto> {
  return authService.register(registerInput(overrides), null);
}

/** Attache un abonnement à un utilisateur, pour les tests de suppression. */
export function attachSubscription(
  userId: string,
  subscription: {
    plan: 'FREE' | 'PLUS';
    status: string;
    cancelAtPeriodEnd?: boolean;
    currentPeriodEnd?: Date | null;
  },
): void {
  void tables.subscription.create({
    data: {
      userId,
      plan: subscription.plan,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
      currentPeriodEnd: subscription.currentPeriodEnd ?? null,
      store: 'GOOGLE_PLAY',
      storeTransactionId: `txn_${userId}`,
      storeOriginalTransactionId: `orig_${userId}`,
      billingCycle: 'MONTHLY',
    },
  });
}

/** Crée une dépense minimale appartenant à `userId`. */
export function attachExpense(userId: string, merchant: string): void {
  void tables.expense.create({
    data: {
      userId,
      merchantRaw: merchant,
      merchantNormalized: merchant,
      merchantOverride: null,
      amount: { toString: () => '13.4900' },
      currency: 'EUR',
      date: new Date('2026-01-05T00:00:00.000Z'),
      frequency: 'MONTHLY',
      category: 'STREAMING',
      paymentMethod: 'CARD',
      notes: null,
      status: 'ACTIVE',
      source: 'IMPORT',
      importBatchId: null,
    },
  });
}
