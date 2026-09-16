import type { Locale } from '@subscription-manager/shared';

import { getServerEnv } from '@/lib/env/server';
import { passwordResetTemplate, resolveLocale } from '@/lib/mail/templates';

/**
 * Envoi d'e-mail transactionnel (réinitialisation de mot de passe uniquement
 * en V1 — `specs/auth-comptes-rgpd.md` §5).
 *
 * ## Ce qui n'est jamais journalisé
 *
 * L'adresse du destinataire, le lien de réinitialisation (il **contient le
 * token brut**), la clé d'API du fournisseur, le corps de la requête et le
 * corps de la réponse. Un journal ne porte que le code HTTP et le nom du
 * transport : c'est suffisant pour diagnostiquer une panne, et insuffisant
 * pour prendre le contrôle d'un compte (CLAUDE.md §6).
 *
 * Seule exception : le transport `console`, **interdit en production**, écrit
 * le lien dans le terminal de développement — c'est sa raison d'être. Même
 * là, l'adresse du destinataire est masquée.
 */
export interface PasswordResetEmail {
  to: string;
  /** Lien complet contenant le token brut — jamais persisté, jamais journalisé. */
  resetUrl: string;
  /** Langue du compte : les traductions sont statiques (CLAUDE.md §5.6). */
  locale: Locale;
}

export interface Mailer {
  sendPasswordReset(email: PasswordResetEmail): Promise<void>;
}

/** Échec d'envoi. Le message ne contient **aucune** donnée personnelle. */
export class MailDeliveryError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'MailDeliveryError';
    this.status = status;
  }
}

/** Configuration incohérente : détectée au démarrage, pas au premier envoi. */
export class MailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailConfigurationError';
  }
}

/**
 * Transport par défaut : n'envoie rien et ne journalise rien.
 *
 * Utile en test. En développement, `getMailer()` lui substitue le transport
 * `console` : un parcours « mot de passe oublié » local doit pouvoir aboutir
 * sans configuration. Refusé en production par `mailerConfigurationIssues()` :
 * un mot de passe oublié y resterait sans réponse, en silence.
 */
const noopMailer: Mailer = {
  sendPasswordReset: () => Promise.resolve(),
};

/**
 * Masque une adresse dans l'aperçu de développement : `alice@gmail.com` →
 * `a***@gmail.com`. Assez pour reconnaître le compte de test, sans recopier
 * l'adresse entière dans un terminal (CLAUDE.md §6).
 */
export function maskEmailAddress(address: string): string {
  const at = address.lastIndexOf('@');

  return at <= 0 ? '***' : `${address.slice(0, 1)}***${address.slice(at)}`;
}

/** Jeton contenu dans le lien, pour un appel direct à la route de réinitialisation. */
function resetTokenFromUrl(resetUrl: string): string | null {
  try {
    return new URL(resetUrl).searchParams.get('token');
  } catch {
    return null;
  }
}

/**
 * Aperçu, pour le terminal de développement, de l'e-mail qui **aurait** été
 * envoyé : objet, langue, validité, lien et texte intégral du message.
 *
 * Le lien et le jeton sont chacun seuls sur leur ligne, sans ponctuation
 * autour : un double-clic ou une sélection de ligne les copie tels quels.
 *
 * ⚠️ Le lien contient le token brut : cet aperçu n'est produit que par le
 * transport `console`, **interdit en production**.
 */
export function formatDevEmailPreview(email: PasswordResetEmail, validityMinutes: number): string {
  const locale = resolveLocale(email.locale);
  const template = passwordResetTemplate(locale, email.resetUrl, validityMinutes);
  const token = resetTokenFromUrl(email.resetUrl);
  const rule = '='.repeat(72);

  return [
    '',
    rule,
    '[dev] E-mail de réinitialisation — NON ENVOYÉ (EMAIL_PROVIDER différent de resend)',
    rule,
    `Destinataire : ${maskEmailAddress(email.to)}`,
    `Langue       : ${locale}`,
    `Objet        : ${template.subject}`,
    `Validité     : ${String(validityMinutes)} minutes, usage unique`,
    '',
    'Lien de réinitialisation (à ouvrir sur le téléphone) :',
    '',
    email.resetUrl,
    '',
    ...(token === null
      ? []
      : [
          'Jeton seul (POST /api/auth/reset-password, corps { "token", "password" }) :',
          '',
          token,
          '',
        ]),
    `--- Texte de l'e-mail ${'-'.repeat(50)}`,
    template.text,
    rule,
    '',
  ].join('\n');
}

/**
 * Transport de développement local : écrit l'e-mail complet dans la sortie
 * standard (`formatDevEmailPreview`) au lieu de l'envoyer.
 *
 * Le lien contient le token brut : ce transport est donc **interdit en
 * production**, où la sortie standard est collectée et conservée.
 */
const consoleMailer: Mailer = {
  sendPasswordReset: ({ to, resetUrl, locale }) => {
    const env = getServerEnv();

    if (env.NODE_ENV === 'production') {
      // Rejet plutôt que jet synchrone : l'interface est asynchrone, et un
      // appelant qui n'attend que le rejet passerait à côté de l'autre forme.
      return Promise.reject(
        new MailConfigurationError('EMAIL_PROVIDER=console est interdit en production.'),
      );
    }

    console.info(
      formatDevEmailPreview({ to, resetUrl, locale }, env.AUTH_PASSWORD_RESET_TTL_MINUTES),
    );

    return Promise.resolve();
  },
};

/**
 * Signale, **en développement uniquement**, une demande de réinitialisation
 * qui ne correspond à aucun compte actif.
 *
 * Sans ce signal, l'aperçu attendu manque sans explication : la réponse
 * publique est volontairement identique dans les deux cas (§5), et le terminal
 * n'affiche qu'un `200`. Hors développement, rien n'est écrit — un journal de
 * production qui distingue les adresses connues des inconnues serait une
 * source d'énumération de comptes. L'adresse reste masquée.
 */
export function reportPasswordResetWithoutAccount(email: string): void {
  if (getServerEnv().NODE_ENV !== 'development') {
    return;
  }

  console.info(
    `[dev] Réinitialisation demandée pour ${maskEmailAddress(email)} : aucun compte actif avec cette adresse dans la base de cette API, donc aucun e-mail préparé. La réponse envoyée à l'application reste identique.`,
  );
}

/** Injectable pour les tests : aucun test n'atteint un fournisseur réel. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Transport réel — API HTTP du fournisseur (Resend).
 *
 * Il **envoie réellement** le message : c'est la seule implémentation autorisée
 * en production. Un échec lève `MailDeliveryError` ; l'appelant décide quoi en
 * faire (voir `auth.service.ts` : la réponse publique reste générique, sans
 * quoi le code de retour révélerait l'existence du compte).
 */
export function createResendMailer(fetchImpl: FetchLike = fetch): Mailer {
  return {
    sendPasswordReset: async ({ to, resetUrl, locale }) => {
      const env = getServerEnv();
      const issues = mailerConfigurationIssues(env);

      if (issues.length > 0) {
        throw new MailConfigurationError(`Configuration e-mail incomplète : ${issues.join(', ')}`);
      }

      const template = passwordResetTemplate(
        resolveLocale(locale),
        resetUrl,
        env.AUTH_PASSWORD_RESET_TTL_MINUTES,
      );

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, env.EMAIL_REQUEST_TIMEOUT_MS);

      let response: Response;

      try {
        response = await fetchImpl(`${env.EMAIL_API_BASE_URL.replace(/\/+$/, '')}/emails`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env.EMAIL_PROVIDER_API_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM,
            to: [to],
            subject: template.subject,
            text: template.text,
            html: template.html,
            ...(env.EMAIL_REPLY_TO.length > 0 ? { reply_to: env.EMAIL_REPLY_TO } : {}),
          }),
          signal: controller.signal,
        });
      } catch (error) {
        // Ni l'URL complète, ni le corps, ni le destinataire : uniquement la
        // nature de la panne.
        throw new MailDeliveryError(
          `Envoi impossible (${error instanceof Error ? error.name : 'erreur inconnue'}).`,
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        // Le corps de la réponse peut contenir l'adresse : il n'est pas lu.
        throw new MailDeliveryError('Le fournisseur a refusé l’envoi.', response.status);
      }
    },
  };
}

/**
 * Problèmes de configuration bloquants, exprimés en **noms de variables**.
 *
 * Aucune valeur n'est renvoyée : ce résultat est destiné à être journalisé au
 * démarrage et à alimenter le contrôle de production.
 */
export function mailerConfigurationIssues(
  env: Pick<
    ReturnType<typeof getServerEnv>,
    'NODE_ENV' | 'EMAIL_PROVIDER' | 'EMAIL_PROVIDER_API_KEY' | 'EMAIL_FROM'
  >,
): string[] {
  const issues: string[] = [];

  if (env.EMAIL_PROVIDER === 'resend') {
    if (env.EMAIL_PROVIDER_API_KEY.trim().length === 0) {
      issues.push('EMAIL_PROVIDER_API_KEY');
    }

    if (env.EMAIL_FROM.trim().length === 0) {
      issues.push('EMAIL_FROM');
    }
  }

  if (env.NODE_ENV === 'production' && env.EMAIL_PROVIDER !== 'resend') {
    issues.push('EMAIL_PROVIDER');
  }

  return issues;
}

let overrideMailer: Mailer | null = null;

/** Substitue le transport. Réservé aux tests. */
export function setMailerForTests(mailer: Mailer | null): void {
  overrideMailer = mailer;
}

export function getMailer(): Mailer {
  if (overrideMailer !== null) {
    return overrideMailer;
  }

  const env = getServerEnv();

  switch (env.EMAIL_PROVIDER) {
    case 'console':
      return consoleMailer;
    case 'resend':
      return createResendMailer();
    default:
      // `noop` est la valeur par défaut : en développement, l'e-mail est tout
      // de même affiché, sans quoi le lien serait introuvable. Les tests
      // (`NODE_ENV=test`) restent silencieux.
      return env.NODE_ENV === 'development' ? consoleMailer : noopMailer;
  }
}

/** Construit le lien de réinitialisation envoyé à l'utilisateur. */
export function buildPasswordResetUrl(token: string): string {
  const base = getServerEnv().PASSWORD_RESET_URL_BASE;
  const separator = base.includes('?') ? '&' : '?';

  return `${base}${separator}token=${encodeURIComponent(token)}`;
}
