import { z } from 'zod';

import { USER_TIERS } from '../constants/enums';
import { countrySchema, currencySchema, emailSchema, localeSchema } from './common';

/**
 * Préférences utilisateur (`User.language`, `User.country`, `User.currency`).
 * Les trois sont indépendantes : ne jamais déduire l'une des autres
 * (CLAUDE.md §4).
 */
export const userPreferencesSchema = z.object({
  language: localeSchema,
  country: countrySchema,
  currency: currencySchema,
});

/**
 * Payload de `PATCH /api/account/preferences` (`specs/auth-comptes-rgpd.md` §6).
 * Les trois champs sont requis : le client renvoie l'état complet des
 * préférences. Ce endpoint sert à modifier les préférences *ultérieurement*,
 * jamais à les choisir initialement (elles sont fixées par `registerSchema`).
 *
 * Aucun `userId` n'est accepté : la mise à jour porte toujours sur
 * `session.user.id`.
 */
export const updatePreferencesSchema = userPreferencesSchema;

/**
 * Écriture d'un `User`. `tier` n'est jamais accepté depuis un client : il est
 * dérivé de `Subscription.plan` par le service d'entitlements (schéma §3).
 */
export const createUserSchema = z.object({
  email: emailSchema,
  passwordHash: z.string().min(1),
  language: localeSchema,
  country: countrySchema,
  currency: currencySchema,
});

export const userTierSchema = z.enum(USER_TIERS);

export type UserPreferencesInput = z.infer<typeof userPreferencesSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
