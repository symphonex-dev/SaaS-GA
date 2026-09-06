import type { TFunction } from 'i18next';

import { ApiError } from './api-client';

/**
 * Traduction des erreurs serveur (`specs/ui-composants-mobile.md` §13).
 *
 * Le message brut du serveur n'est **jamais** affiché : seul le `code` stable
 * est utilisé pour choisir un texte traduit. Un code inconnu retombe sur un
 * message générique plutôt que d'exposer un détail technique.
 */
export function errorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`;
    const translated = t(key);

    return translated === key ? t('errors.unknown') : translated;
  }

  return t('errors.unknown');
}

/** Code d'erreur exploitable par l'UI (blocage de suppression, quota…). */
export function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

/** Champ de formulaire en faute, renvoyé par la validation serveur. */
export function errorField(error: unknown): string | null {
  return error instanceof ApiError ? (error.field ?? null) : null;
}
