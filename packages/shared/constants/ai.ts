/**
 * Assistant IA borné (`specs/comparateur-et-assistant-ia.md` partie B).
 *
 * L'IA n'est jamais source de vérité : elle met en phrase des chiffres déjà
 * calculés par les services déterministes (B.1). Elle ne modifie jamais la base
 * de données et ne peut déclencher aucune action.
 */

/**
 * Les **trois** seuls usages autorisés en V1 (B.2 et CLAUDE.md §5.6).
 *
 * Cette liste est fermée : toute autre tâche (chatbot ouvert, prédiction,
 * conseil personnalisé, catégorisation, traduction…) est explicitement hors
 * périmètre et ne doit exister ni en route, ni en service, ni en composant.
 */
export const AI_TASKS = ['MONTHLY_SUMMARY', 'EXPLAIN_INCREASE', 'RECOMMENDATION'] as const;
export type AiTask = (typeof AI_TASKS)[number];

/** Niveau d'incertitude déclaré par le modèle (B.7). */
export const AI_UNCERTAINTY_LEVELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH'] as const;
export type AiUncertainty = (typeof AI_UNCERTAINTY_LEVELS)[number];

/** Nombre maximal d'identifiants de dépense référencés par une réponse (B.7). */
export const AI_MAX_REFERENCED_EXPENSES = 20;

/** Longueur maximale d'une réponse validée (B.7). */
export const AI_MAX_ANSWER_LENGTH = 1200;
