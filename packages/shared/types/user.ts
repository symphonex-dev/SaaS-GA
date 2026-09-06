import type { CountryCode } from '../constants/countries';
import type { Currency } from '../constants/currencies';
import type { GoalStatus, UserTier } from '../constants/enums';
import type { Locale } from '../constants/locales';
import type { Id, IsoDateTimeString, MoneyDto } from './common';

/**
 * Projection publique du modèle `User`.
 * `passwordHash` et `deletedAt` ne sont jamais exposés (schéma §3).
 */
export interface UserDto {
  id: Id;
  email: string;
  language: Locale;
  country: CountryCode;
  currency: Currency;
  /** Dérivé exclusivement de `Subscription.plan` (jamais modifiable par le client). */
  tier: UserTier;
  createdAt: IsoDateTimeString;
}

/** Préférences modifiables par l'utilisateur — indépendantes les unes des autres. */
export interface UserPreferencesDto {
  language: Locale;
  country: CountryCode;
  currency: Currency;
}

/**
 * Projection d'une `AuthSession`. Le token brut n'existe qu'une seule fois, à
 * la création de la session, et n'est jamais stocké (schéma §10).
 */
export interface AuthSessionDto {
  id: Id;
  deviceLabel: string | null;
  createdAt: IsoDateTimeString;
  lastUsedAt: IsoDateTimeString;
  expiresAt: IsoDateTimeString;
  revokedAt: IsoDateTimeString | null;
}

/** Réponse d'authentification : le token opaque + l'utilisateur courant. */
export interface AuthenticatedSessionDto {
  token: string;
  expiresAt: IsoDateTimeString;
  user: UserDto;
}

/**
 * Identité de la session courante, telle que renvoyée par `requireUser()`
 * (`specs/auth-comptes-rgpd.md` §1) : strictement les champs nécessaires à
 * l'autorisation et au rendu, jamais `passwordHash` ni `deletedAt`.
 */
export interface AuthenticatedUser {
  id: Id;
  email: string;
  tier: UserTier;
  language: Locale;
  country: CountryCode;
  currency: Currency;
}

/**
 * Export RGPD complet (`specs/auth-comptes-rgpd.md` §8).
 *
 * Ne contient jamais : `passwordHash`, tokens de réinitialisation, empreintes
 * de session, secrets serveur, identifiants de transaction des stores.
 */
export interface UserDataExport {
  exportedAt: IsoDateTimeString;
  user: {
    id: Id;
    email: string;
    language: Locale;
    country: CountryCode;
    currency: Currency;
    tier: UserTier;
    createdAt: IsoDateTimeString;
  };
  expenses: unknown[];
  recurringDetections: unknown[];
  savingsGoals: unknown[];
  subscription: unknown;
}

/** Projection du modèle `UserSavingsGoal` (schéma §8). */
export interface UserSavingsGoalDto {
  id: Id;
  targetAmount: MoneyDto;
  achievedAmount: MoneyDto;
  status: GoalStatus;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

/** Projection du modèle `AiQuota` (schéma §12) : un enregistrement par période. */
export interface AiQuotaDto {
  periodStart: IsoDateTimeString;
  creditsGranted: number;
  creditsUsed: number;
  creditsRemaining: number;
}
