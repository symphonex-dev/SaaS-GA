import { ERROR_CODES, type AuthenticatedUser } from '@subscription-manager/shared';

import { AppError } from '@/lib/api/errors';
import { getServerEnv } from '@/lib/env/server';
import { requireUser } from '@/server/auth/session';

/**
 * Contrôle d'accès aux routes d'administration
 * (`specs/comparateur-et-assistant-ia.md` A.8).
 *
 * Le rôle est déterminé **exclusivement côté serveur** : il provient de la
 * variable d'environnement `ADMIN_EMAILS`, jamais d'un champ envoyé par le
 * client, jamais d'une colonne modifiable par un utilisateur.
 *
 * Choix documenté (CLAUDE.md §10.7) : `specs/schema-donnees.md` fixe une liste
 * fermée de modèles et ne prévoit aucun rôle sur `User`. Une liste blanche
 * d'exploitation satisfait l'exigence « déterminé exclusivement côté serveur »
 * sans ajouter au schéma un champ que le produit n'expose pas.
 *
 * Comportement en cas de configuration absente : **personne** n'est
 * administrateur. La sécurité échoue toujours du côté fermé.
 */
export interface AdminActor {
  userId: string;
  email: string;
}

/** Liste blanche normalisée (minuscules, sans entrée vide). */
export function adminEmails(): readonly string[] {
  return getServerEnv()
    .ADMIN_EMAILS.split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function isAdminUser(user: AuthenticatedUser): boolean {
  const allowlist = adminEmails();

  return allowlist.length > 0 && allowlist.includes(user.email.toLowerCase());
}

/**
 * Exige une session valide **et** un compte figurant dans la liste blanche.
 *
 * Un utilisateur standard authentifié reçoit `ADMIN_FORBIDDEN` (403), jamais
 * l'accès : l'authentification ne vaut pas autorisation.
 */
export async function requireAdmin(request: Request): Promise<AdminActor> {
  const user = await requireUser(request);

  if (!isAdminUser(user)) {
    throw new AppError(ERROR_CODES.ADMIN_FORBIDDEN, 'Accès réservé à l’administration.');
  }

  return { userId: user.id, email: user.email };
}
