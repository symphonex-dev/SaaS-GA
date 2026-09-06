/**
 * Point d'entrée exécuté une fois au démarrage du serveur Next.js.
 *
 * Il ne fait qu'une chose : refuser de démarrer si la configuration de
 * production annulerait une protection ou perdrait des données
 * (`src/lib/env/production-readiness.ts`).
 *
 * Échouer ici est délibéré. Les alternatives sont pires : servir du trafic avec
 * un rate limiting inopérant, des imports qui se perdent d'une instance à
 * l'autre, ou une réinitialisation de mot de passe qui n'envoie rien — trois
 * pannes silencieuses qui ne se voient qu'en production.
 */
export async function register(): Promise<void> {
  // Import différé : `instrumentation.ts` est chargé avant le reste du serveur,
  // et rien ici ne doit dépendre du runtime des routes.
  const { getServerEnv } = await import('@/lib/env/server');
  const { assertProductionReady } = await import('@/lib/env/production-readiness');

  assertProductionReady(getServerEnv());
}
