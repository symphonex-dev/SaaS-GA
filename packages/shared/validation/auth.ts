import { z } from 'zod';

import { countrySchema, currencySchema, emailSchema, localeSchema, passwordSchema } from './common';

/**
 * Schémas d'authentification (`specs/auth-comptes-rgpd.md` §2, §4, §5, §9).
 *
 * Partagés entre `apps/api` (validation d'entrée) et `apps/mobile`
 * (react-hook-form + résolveur Zod) : une seule définition, donc jamais de
 * divergence entre la validation du formulaire et celle du serveur.
 */

/**
 * Inscription. `language`/`country`/`currency` sont choisis pendant
 * l'onboarding, avant la création de compte, et transmis ici (§6).
 *
 * `emailSchema` accepte toute adresse valide au sens RFC : aucune liste blanche
 * de domaines, aucun traitement particulier par fournisseur (§2).
 */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  language: localeSchema,
  country: countrySchema,
  currency: currencySchema,
});

/**
 * Connexion. Le mot de passe n'est ici contraint qu'en longueur maximale : une
 * contrainte de longueur minimale renverrait une erreur de validation
 * différente d'un échec d'authentification, ce qui aiderait un attaquant.
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

/** Demande de réinitialisation — la réponse est toujours générique (§5). */
export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

/** Consommation d'un token de réinitialisation : usage unique, expiration courte. */
export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  password: passwordSchema,
});

/** Suppression de compte : confirmation explicite obligatoire (§9). */
export const deleteAccountSchema = z.object({
  confirmation: z.literal('DELETE_MY_ACCOUNT'),
});

/** Libellé d'appareil facultatif, informatif — jamais un critère d'autorisation. */
export const deviceLabelSchema = z.string().trim().min(1).max(100);

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
