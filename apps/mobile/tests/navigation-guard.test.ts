import { describe, expect, it } from 'vitest';

import {
  AUTHENTICATED_ENTRY,
  ONBOARDING_ENTRY,
  PUBLIC_SEGMENTS,
  resolveGuardRedirect,
} from '../lib/navigation-guard';

/**
 * Garde de navigation (mission §6, §7 et §22).
 *
 * Règle produit vérifiée : aucun mode invité. Aucun écran fonctionnel n'est
 * atteignable sans session — y compris par lien profond (CLAUDE.md §5.14).
 */
const guard = (
  segments: readonly string[],
  isAuthenticated: boolean,
  isSessionLoading = false,
): string | null => resolveGuardRedirect({ segments, isAuthenticated, isSessionLoading });

describe('session en cours de validation', () => {
  it('ne redirige nulle part tant que la session n’est pas tranchée', () => {
    expect(guard([], false, true)).toBeNull();
    expect(guard(['(tabs)', 'dashboard'], false, true)).toBeNull();
    expect(guard(['(auth)', 'login'], true, true)).toBeNull();
  });
});

describe('session absente', () => {
  it('oriente la racine vers l’onboarding', () => {
    expect(guard([], false)).toBe(ONBOARDING_ENTRY);
  });

  it.each([
    ['(onboarding)', 'welcome'],
    ['(auth)', 'login'],
    ['(auth)', 'register'],
    ['(auth)', 'forgot-password'],
    ['(auth)', 'reset-password'],
    ['legal', 'privacy'],
    ['legal', 'terms'],
    ['legal', 'cookies'],
  ])('laisse accéder à /%s/%s', (group, screen) => {
    expect(guard([group, screen], false)).toBeNull();
  });

  it.each([
    [['(tabs)', 'dashboard']],
    [['(tabs)', 'transactions']],
    [['(tabs)', 'settings']],
    [['(import)', 'choose-source']],
    [['(import)', 'review-lines']],
    [['expense', 'new']],
    [['expense', '[id]']],
    [['subscription-detail', '[id]']],
    [['comparison', '[expenseId]']],
    [['billing', 'pricing']],
    [['billing', 'manage-subscription']],
    [['account', 'export']],
    [['account', 'delete-account']],
    [['help']],
    [['contact']],
  ])('renvoie %j vers l’inscription', (segments) => {
    expect(guard(segments, false)).toBe(ONBOARDING_ENTRY);
  });

  it('renvoie un lien profond inconnu vers l’inscription plutôt que de l’ouvrir', () => {
    expect(guard(['whatever-deep-link'], false)).toBe(ONBOARDING_ENTRY);
  });
});

describe('session valide', () => {
  it('oriente la racine vers le tableau de bord', () => {
    expect(guard([], true)).toBe(AUTHENTICATED_ENTRY);
  });

  it.each([
    [['(onboarding)', 'welcome']],
    [['(onboarding)', 'language-country-currency']],
    [['(auth)', 'login']],
    [['(auth)', 'register']],
  ])('ne laisse pas %j coincer une session valide dans l’avant-inscription', (segments) => {
    expect(guard(segments, true)).toBe(AUTHENTICATED_ENTRY);
  });

  it.each([
    [['(tabs)', 'dashboard']],
    [['(import)', 'upload']],
    [['expense', 'new']],
    [['comparison', 'abc']],
    [['legal', 'privacy']],
    [['help']],
  ])('laisse %j tel quel', (segments) => {
    expect(guard(segments, true)).toBeNull();
  });
});

describe('session expirée ou révoquée', () => {
  it('se comporte exactement comme une session absente', () => {
    // Le store efface le token quand le serveur rejette la session : la garde
    // ne voit alors plus qu'un utilisateur non authentifié.
    expect(guard(['(tabs)', 'dashboard'], false)).toBe(ONBOARDING_ENTRY);
    expect(guard([], false)).toBe(ONBOARDING_ENTRY);
  });
});

describe('lien profond de réinitialisation de mot de passe', () => {
  it("reste accessible sans session : c'est précisément son cas d'usage", () => {
    // `subscription-manager://reset-password?token=…` résout vers
    // `app/(auth)/reset-password.tsx` — les groupes sont retirés de l'URL.
    expect(guard(['(auth)', 'reset-password'], false)).toBeNull();
  });

  it('renvoie vers le tableau de bord si une session est déjà ouverte', () => {
    expect(guard(['(auth)', 'reset-password'], true)).toBe(AUTHENTICATED_ENTRY);
  });
});

describe('stabilité de la garde', () => {
  it('ne renvoie jamais la destination déjà atteinte (aucune boucle possible)', () => {
    // Appliquer la garde à sa propre destination doit être un point fixe.
    expect(guard(['(onboarding)', 'welcome'], false)).toBeNull();
    expect(guard(['(tabs)', 'dashboard'], true)).toBeNull();
  });

  it('n’expose que trois groupes publics', () => {
    expect([...PUBLIC_SEGMENTS].sort()).toEqual(['(auth)', '(onboarding)', 'legal']);
  });
});
