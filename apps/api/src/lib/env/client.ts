import { z } from 'zod';

/**
 * Configuration **publique** des pages légales de `apps/api`.
 *
 * Ce module est le pendant de `env/server.ts` et n'expose que des valeurs
 * destinées à être lues par tout le monde : nom affiché, adresse de contact,
 * URL publique. Aucun secret n'a le droit d'y figurer — ni clé de store, ni
 * clé IA, ni secret de session (CLAUDE.md §6).
 *
 * Les variables sont préfixées `NEXT_PUBLIC_` : Next.js les inline dans le
 * bundle, ce qui est précisément la raison pour laquelle aucun secret ne doit
 * transiter ici.
 */
const clientEnvSchema = z.object({
  /** URL publique des pages légales, utilisée dans les liens des stores. */
  NEXT_PUBLIC_APP_URL: z.string().default('https://example.com'),

  /** Adresse de contact affichée sur la page « Contact » et exigée par le RGPD. */
  NEXT_PUBLIC_CONTACT_EMAIL: z.string().default('contact@example.com'),

  /** Entité responsable du traitement, affichée dans la politique de confidentialité. */
  NEXT_PUBLIC_COMPANY_NAME: z.string().default('Gestionnaire d’abonnements'),

  /**
   * Date de dernière mise à jour des documents légaux (`YYYY-MM-DD`).
   * Affichée telle quelle : elle n'est jamais déduite de l'horloge serveur,
   * une page légale devant porter la date de sa dernière révision réelle.
   */
  NEXT_PUBLIC_LEGAL_UPDATED_AT: z.string().default('2026-08-29'),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Les accès sont écrits en toutes lettres : Next.js ne remplace `process.env`
 * qu'à partir d'une lecture littérale, jamais via un accès dynamique.
 */
export function getClientEnv(): ClientEnv {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_CONTACT_EMAIL: process.env.NEXT_PUBLIC_CONTACT_EMAIL,
    NEXT_PUBLIC_COMPANY_NAME: process.env.NEXT_PUBLIC_COMPANY_NAME,
    NEXT_PUBLIC_LEGAL_UPDATED_AT: process.env.NEXT_PUBLIC_LEGAL_UPDATED_AT,
  });

  if (!parsed.success) {
    // Ne jamais journaliser les valeurs, même publiques : seuls les noms.
    const invalidKeys = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Configuration publique invalide : ${invalidKeys}`);
  }

  return parsed.data;
}
