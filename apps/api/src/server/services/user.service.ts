import {
  DEFAULT_COUNTRY,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  countrySchema,
  currencySchema,
  localeSchema,
  type UpdatePreferencesInput,
  type UserDataExport,
  type UserDto,
} from '@subscription-manager/shared';
import type { Subscription, User } from '@prisma/client';

import { AuthErrors } from '@/lib/api/errors';
import { effectivePlan } from '@/server/entitlements/entitlements';
import { accountRepository } from '@/server/repositories/account.repository';
import { authSessionRepository } from '@/server/repositories/auth-session.repository';
import { subscriptionRepository } from '@/server/repositories/subscription.repository';
import { userRepository } from '@/server/repositories/user.repository';

/**
 * Service de compte : profil, préférences, export RGPD, suppression
 * (`specs/auth-comptes-rgpd.md` §6, §8, §9).
 *
 * Toutes les opérations portent sur l'utilisateur de la session ; aucun
 * identifiant fourni par le client n'est accepté (CLAUDE.md §5.3).
 */

/**
 * Projection publique d'un `User` : jamais `passwordHash`, jamais `deletedAt`.
 *
 * `tier` est dérivé de l'abonnement, jamais recopié depuis la colonne
 * (`specs/schema-donnees.md` §3, `specs/paiement-in-app.md` §7) : un abonnement
 * échu ou suspendu ne peut donc pas afficher « Plus ».
 */
export function toUserDto(
  user: User,
  subscription: Subscription | null,
  now: Date = new Date(),
): UserDto {
  const language = localeSchema.safeParse(user.language);
  const country = countrySchema.safeParse(user.country);
  const currency = currencySchema.safeParse(user.currency);

  return {
    id: user.id,
    email: user.email,
    language: language.success ? language.data : DEFAULT_LOCALE,
    country: country.success ? country.data : DEFAULT_COUNTRY,
    currency: currency.success ? currency.data : DEFAULT_CURRENCY,
    tier: effectivePlan(subscription, now),
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Précondition de suppression de compte (`specs/auth-comptes-rgpd.md` §9).
 *
 * Seul un abonnement payant **encore actif et non résilié** bloque la
 * suppression. Résilier débloque immédiatement, sans attendre
 * `currentPeriodEnd` (CLAUDE.md §5.9).
 */
export function canDeleteAccount(subscription: Subscription | null): boolean {
  if (subscription === null) {
    return true;
  }

  if (subscription.plan === 'FREE') {
    return true;
  }

  if (subscription.status === 'EXPIRED') {
    return true;
  }

  if (subscription.cancelAtPeriodEnd) {
    return true;
  }

  return false;
}

export const userService = {
  async getProfile(userId: string): Promise<UserDto> {
    const [user, subscription] = await Promise.all([
      userRepository.findActiveById(userId),
      subscriptionRepository.findByUserId(userId),
    ]);

    if (user === null) {
      throw AuthErrors.unauthorized();
    }

    return toUserDto(user, subscription);
  },

  /** Met à jour `User WHERE id = session.user.id` — jamais `body.userId` (§6). */
  async updatePreferences(userId: string, preferences: UpdatePreferencesInput): Promise<UserDto> {
    const updated = await userRepository.updatePreferences(userId, preferences);
    const subscription = await subscriptionRepository.findByUserId(userId);

    return toUserDto(updated, subscription);
  },

  /**
   * Export RGPD (§8). Ne contient jamais `passwordHash`, ni token de
   * réinitialisation, ni empreinte de session, ni identifiant de transaction
   * de store.
   */
  async exportData(userId: string, now: Date = new Date()): Promise<UserDataExport> {
    const user = await userRepository.findActiveById(userId);

    if (user === null) {
      throw AuthErrors.unauthorized();
    }

    const data = await accountRepository.collectForExport(userId);
    const subscription = await subscriptionRepository.findByUserId(userId);
    const profile = toUserDto(user, subscription, now);

    return {
      exportedAt: now.toISOString(),
      user: {
        id: profile.id,
        email: profile.email,
        language: profile.language,
        country: profile.country,
        currency: profile.currency,
        tier: profile.tier,
        createdAt: profile.createdAt,
      },
      expenses: data.expenses.map((expense) => ({
        id: expense.id,
        merchantRaw: expense.merchantRaw,
        merchantNormalized: expense.merchantNormalized,
        merchantOverride: expense.merchantOverride,
        amount: expense.amount.toString(),
        currency: expense.currency,
        date: expense.date.toISOString(),
        frequency: expense.frequency,
        category: expense.category,
        paymentMethod: expense.paymentMethod,
        notes: expense.notes,
        status: expense.status,
        source: expense.source,
        importBatchId: expense.importBatchId,
        createdAt: expense.createdAt.toISOString(),
      })),
      recurringDetections: data.recurringDetections.map((detection) => ({
        id: detection.id,
        expenseId: detection.expenseId,
        frequency: detection.frequency,
        confidenceScore: detection.confidenceScore,
        status: detection.status,
        intervalDays: detection.intervalDays,
        amountVariance: detection.amountVariance.toString(),
        createdAt: detection.createdAt.toISOString(),
        updatedAt: detection.updatedAt.toISOString(),
      })),
      savingsGoals: data.savingsGoals.map((goal) => ({
        id: goal.id,
        targetAmount: goal.targetAmount.toString(),
        achievedAmount: goal.achievedAmount.toString(),
        currency: goal.currency,
        status: goal.status,
        createdAt: goal.createdAt.toISOString(),
        updatedAt: goal.updatedAt.toISOString(),
      })),
      subscription:
        data.subscription === null
          ? null
          : {
              // Les identifiants de transaction des stores sont volontairement
              // omis : ils ne sont pas nécessaires à l'utilisateur (§8).
              store: data.subscription.store,
              plan: data.subscription.plan,
              status: data.subscription.status,
              billingCycle: data.subscription.billingCycle,
              currentPeriodEnd: data.subscription.currentPeriodEnd?.toISOString() ?? null,
              cancelAtPeriodEnd: data.subscription.cancelAtPeriodEnd,
              canceledAt: data.subscription.canceledAt?.toISOString() ?? null,
              createdAt: data.subscription.createdAt.toISOString(),
            },
    };
  },

  /**
   * Suppression irréversible (§9).
   *
   * Ordre imposé par la spec : vérification de la précondition, puis révocation
   * explicite de toutes les sessions **avant** la transaction de suppression —
   * ainsi la session de la requête courante est invalidée immédiatement, même
   * si la transaction échoue ensuite.
   */
  async deleteAccount(userId: string, now: Date = new Date()): Promise<void> {
    const subscription = await subscriptionRepository.findByUserId(userId);

    if (!canDeleteAccount(subscription)) {
      throw AuthErrors.deletionBlockedByActiveSubscription();
    }

    await authSessionRepository.revokeAllForUser(userId, now);
    await accountRepository.deleteAccount(userId);
  },
};
