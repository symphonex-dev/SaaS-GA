/**
 * Point d'entrée du code partagé entre `apps/api` et `apps/mobile`.
 *
 * Règle : ce package ne contient jamais de logique métier financière exécutée
 * côté client (voir CLAUDE.md §2.3 et §5.1) — uniquement des types, des
 * constantes et des schémas de validation.
 */
export * from './constants/index';
export * from './finance/index';
export * from './types/index';
export * from './validation/index';
