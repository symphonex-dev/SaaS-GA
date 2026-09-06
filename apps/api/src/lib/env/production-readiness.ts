import { mailerConfigurationIssues } from '@/lib/mail/mailer';
import type { ServerEnv } from '@/lib/env/server';

/**
 * Contrôle de configuration de production.
 *
 * Il répond à une seule question : « cette configuration peut-elle servir du
 * trafic réel sans perdre de données ni annuler une protection ? »
 *
 * ⚠️ Le résultat ne contient que des **noms de variables** et des explications
 * fixes — jamais une valeur. Il est journalisé au démarrage et lu par la CI
 * (CLAUDE.md §6 : aucune donnée sensible dans les logs).
 */
export interface ReadinessIssue {
  /** Variable d'environnement en cause. */
  variable: string;
  /** Pourquoi c'est bloquant, en une phrase. */
  reason: string;
}

type ReadinessEnv = Pick<
  ServerEnv,
  | 'NODE_ENV'
  | 'EMAIL_PROVIDER'
  | 'EMAIL_PROVIDER_API_KEY'
  | 'EMAIL_FROM'
  | 'IMPORT_PREVIEW_STORE'
  | 'RATE_LIMIT_STORE'
>;

const REASONS: Readonly<Record<string, string>> = {
  EMAIL_PROVIDER:
    "sans transport réel, une demande de mot de passe oublié reste sans réponse et l'utilisateur est bloqué hors de son compte.",
  EMAIL_PROVIDER_API_KEY:
    "le transport réel est sélectionné mais n'a aucune clé : aucun envoi ne partira.",
  EMAIL_FROM:
    "le transport réel est sélectionné mais n'a aucun expéditeur : le fournisseur refusera l'envoi.",
  IMPORT_PREVIEW_STORE:
    "en mémoire de process, la confirmation d'import échoue dès qu'elle atteint une autre instance, et tout redémarrage perd les aperçus en cours.",
  RATE_LIMIT_STORE:
    'en mémoire de process, chaque instance compte séparément : avec N instances la limite réelle est N fois la limite annoncée.',
};

/**
 * Problèmes bloquants pour un déploiement de production.
 *
 * Hors production, la liste est toujours vide : `memory` et `console` sont des
 * choix légitimes en développement.
 */
export function productionReadinessIssues(env: ReadinessEnv): ReadinessIssue[] {
  if (env.NODE_ENV !== 'production') {
    return [];
  }

  const issues: ReadinessIssue[] = [];

  for (const variable of mailerConfigurationIssues(env)) {
    issues.push({ variable, reason: REASONS[variable] ?? 'configuration incomplète.' });
  }

  if (env.IMPORT_PREVIEW_STORE !== 'postgres') {
    issues.push({
      variable: 'IMPORT_PREVIEW_STORE',
      reason: REASONS['IMPORT_PREVIEW_STORE'] ?? '',
    });
  }

  if (env.RATE_LIMIT_STORE !== 'postgres') {
    issues.push({ variable: 'RATE_LIMIT_STORE', reason: REASONS['RATE_LIMIT_STORE'] ?? '' });
  }

  return issues;
}

/**
 * Échoue fermé : une configuration de production dangereuse empêche le serveur
 * de démarrer, plutôt que de laisser passer du trafic avec une protection
 * inopérante ou des imports qui se perdent.
 */
export function assertProductionReady(env: ReadinessEnv): void {
  const issues = productionReadinessIssues(env);

  if (issues.length === 0) {
    return;
  }

  const details = issues.map((issue) => `  - ${issue.variable} : ${issue.reason}`).join('\n');

  throw new Error(`Configuration de production incomplète :\n${details}`);
}
