import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetServerEnvCache } from '@/lib/env/server';
import {
  MailConfigurationError,
  MailDeliveryError,
  buildPasswordResetUrl,
  createResendMailer,
  formatDevEmailPreview,
  getMailer,
  maskEmailAddress,
  reportPasswordResetWithoutAccount,
  setMailerForTests,
  type FetchLike,
} from '@/lib/mail/mailer';
import { passwordResetTemplate, resolveLocale } from '@/lib/mail/templates';
import { assertProductionReady, productionReadinessIssues } from '@/lib/env/production-readiness';

/**
 * Envoi réel de l'e-mail de réinitialisation (`specs/auth-comptes-rgpd.md` §5).
 *
 * Le transport HTTP est exercé pour de bon — seul l'appel réseau est substitué.
 * Aucun test n'atteint un fournisseur : la clé d'API n'existe pas ici.
 */
const previousEnv = { ...process.env };

function configureResend(): void {
  process.env['EMAIL_PROVIDER'] = 'resend';
  process.env['EMAIL_PROVIDER_API_KEY'] = 'cle-de-test';
  process.env['EMAIL_FROM'] = 'Gestionnaire <no-reply@example.com>';
  process.env['EMAIL_API_BASE_URL'] = 'https://api.example.com';
  resetServerEnvCache();
}

beforeEach(() => {
  process.env = { ...previousEnv };
  resetServerEnvCache();
  setMailerForTests(null);
});

afterEach(() => {
  process.env = { ...previousEnv };
  resetServerEnvCache();
  setMailerForTests(null);
});

function okResponse(): Response {
  return new Response(JSON.stringify({ id: 'msg_1' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('transport réel', () => {
  it('envoie réellement une requête au fournisseur', async () => {
    configureResend();

    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });

      return Promise.resolve(okResponse());
    };

    await createResendMailer(fetchImpl).sendPasswordReset({
      to: 'utilisateur@example.com',
      resetUrl: 'subscription-manager://reset-password?token=abc',
      locale: 'fr',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.example.com/emails');
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('authentifie l’appel avec la clé du fournisseur', async () => {
    configureResend();

    let headers: Record<string, string> = {};
    const fetchImpl: FetchLike = (_url, init) => {
      headers = init.headers as Record<string, string>;

      return Promise.resolve(okResponse());
    };

    await createResendMailer(fetchImpl).sendPasswordReset({
      to: 'utilisateur@example.com',
      resetUrl: 'subscription-manager://reset-password?token=abc',
      locale: 'en',
    });

    expect(headers['authorization']).toBe('Bearer cle-de-test');
  });

  it('transporte le destinataire, le sujet et le lien dans le corps', async () => {
    configureResend();

    let body: Record<string, unknown> = {};
    const fetchImpl: FetchLike = (_url, init) => {
      body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<
        string,
        unknown
      >;

      return Promise.resolve(okResponse());
    };

    await createResendMailer(fetchImpl).sendPasswordReset({
      to: 'utilisateur@example.com',
      resetUrl: 'subscription-manager://reset-password?token=abc',
      locale: 'fr',
    });

    expect(body['to']).toEqual(['utilisateur@example.com']);
    expect(body['from']).toBe('Gestionnaire <no-reply@example.com>');
    expect(String(body['text'])).toContain('subscription-manager://reset-password?token=abc');
    expect(String(body['html'])).toContain('subscription-manager://reset-password?token=abc');
  });

  it('ajoute l’adresse de réponse seulement si elle est configurée', async () => {
    configureResend();

    let body: Record<string, unknown> = {};
    const fetchImpl: FetchLike = (_url, init) => {
      body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<
        string,
        unknown
      >;

      return Promise.resolve(okResponse());
    };

    await createResendMailer(fetchImpl).sendPasswordReset({
      to: 'a@example.com',
      resetUrl: 'x',
      locale: 'en',
    });

    expect(body['reply_to']).toBeUndefined();

    process.env['EMAIL_REPLY_TO'] = 'support@example.com';
    resetServerEnvCache();

    await createResendMailer(fetchImpl).sendPasswordReset({
      to: 'a@example.com',
      resetUrl: 'x',
      locale: 'en',
    });

    expect(body['reply_to']).toBe('support@example.com');
  });

  it('lève une erreur typée quand le fournisseur refuse', async () => {
    configureResend();

    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        new Response('{"message":"utilisateur@example.com est invalide"}', { status: 422 }),
      );

    await expect(
      createResendMailer(fetchImpl).sendPasswordReset({
        to: 'utilisateur@example.com',
        resetUrl: 'subscription-manager://reset-password?token=abc',
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(MailDeliveryError);
  });

  it('ne met ni adresse, ni lien, ni clé dans le message d’erreur', async () => {
    configureResend();

    const fetchImpl: FetchLike = () =>
      Promise.resolve(new Response('{"message":"utilisateur@example.com"}', { status: 500 }));

    const error = await createResendMailer(fetchImpl)
      .sendPasswordReset({
        to: 'utilisateur@example.com',
        resetUrl: 'subscription-manager://reset-password?token=secret-token',
        locale: 'en',
      })
      .catch((caught: unknown) => caught);

    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    expect(message).not.toContain('utilisateur@example.com');
    expect(message).not.toContain('secret-token');
    expect(message).not.toContain('cle-de-test');
  });

  it('ne met rien de sensible dans le message quand le réseau échoue', async () => {
    configureResend();

    const fetchImpl: FetchLike = () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1'));

    const error = await createResendMailer(fetchImpl)
      .sendPasswordReset({
        to: 'utilisateur@example.com',
        resetUrl: 'subscription-manager://reset-password?token=secret-token',
        locale: 'en',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MailDeliveryError);
    expect(String((error as Error).message)).not.toContain('secret-token');
    expect(String((error as Error).message)).not.toContain('utilisateur@example.com');
  });

  it('refuse d’envoyer avec une configuration incomplète', async () => {
    process.env['EMAIL_PROVIDER'] = 'resend';
    process.env['EMAIL_PROVIDER_API_KEY'] = '';
    process.env['EMAIL_FROM'] = '';
    resetServerEnvCache();

    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(okResponse()));

    await expect(
      createResendMailer(fetchImpl).sendPasswordReset({
        to: 'a@example.com',
        resetUrl: 'x',
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(MailConfigurationError);

    // Rien n'est parti : la configuration est vérifiée avant l'appel.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('sélection du transport', () => {
  it('choisit le transport réel quand `EMAIL_PROVIDER=resend`', async () => {
    process.env['EMAIL_PROVIDER'] = 'resend';
    process.env['EMAIL_PROVIDER_API_KEY'] = '';
    process.env['EMAIL_FROM'] = '';
    resetServerEnvCache();

    // Preuve par le comportement : le transport par défaut résout en silence,
    // le transport réel refuse une configuration incomplète.
    await expect(
      getMailer().sendPasswordReset({ to: 'a@example.com', resetUrl: 'x', locale: 'en' }),
    ).rejects.toBeInstanceOf(MailConfigurationError);
  });

  it('n’envoie rien avec le transport par défaut', async () => {
    process.env['EMAIL_PROVIDER'] = 'noop';
    resetServerEnvCache();

    await expect(
      getMailer().sendPasswordReset({ to: 'a@example.com', resetUrl: 'x', locale: 'en' }),
    ).resolves.toBeUndefined();
  });

  it('refuse le transport `console` en production', async () => {
    process.env['EMAIL_PROVIDER'] = 'console';
    // `NODE_ENV` est typé en lecture seule : on remplace l'objet complet, ce
    // que `afterEach` restaure de toute façon.
    process.env = { ...process.env, NODE_ENV: 'production' };
    resetServerEnvCache();

    await expect(
      getMailer().sendPasswordReset({ to: 'a@example.com', resetUrl: 'x', locale: 'en' }),
    ).rejects.toBeInstanceOf(MailConfigurationError);
  });
});

describe('gabarits traduits', () => {
  it('couvre les trois langues du produit', () => {
    for (const locale of ['en', 'fr', 'es'] as const) {
      const template = passwordResetTemplate(locale, 'https://example.com/reset', 30);

      expect(template.subject.length).toBeGreaterThan(0);
      expect(template.text).toContain('https://example.com/reset');
      expect(template.html).toContain('https://example.com/reset');
      expect(template.text).toContain('30');
    }
  });

  it('produit trois sujets distincts : rien n’est laissé en anglais', () => {
    const subjects = (['en', 'fr', 'es'] as const).map(
      (locale) => passwordResetTemplate(locale, 'x', 30).subject,
    );

    expect(new Set(subjects).size).toBe(3);
  });

  it('retombe sur l’anglais pour une langue inconnue', () => {
    expect(resolveLocale('de')).toBe('en');
    expect(resolveLocale('fr')).toBe('fr');
  });

  it('échappe le lien injecté dans le HTML', () => {
    const template = passwordResetTemplate('en', 'https://x/?a=1&b="><script>', 30);

    expect(template.html).not.toContain('<script>');
    expect(template.html).toContain('&amp;');
  });

  it('ne divulgue aucune donnée de compte', () => {
    const template = passwordResetTemplate('fr', 'https://example.com/reset', 30);

    // Le message ne contient que le lien et sa validité : ni e-mail, ni montant,
    // ni identifiant. Un e-mail transite par des serveurs tiers.
    expect(template.text).not.toMatch(/@/);
  });
});

describe('aperçu de l’e-mail dans le terminal de développement', () => {
  const email = {
    to: 'alice.martin@gmail.com',
    resetUrl: 'subscription-manager://reset-password?token=abc_DEF-123',
    locale: 'fr' as const,
  };

  function useDevelopment(provider: 'console' | 'noop'): void {
    process.env = { ...previousEnv, NODE_ENV: 'development', EMAIL_PROVIDER: provider };
    resetServerEnvCache();
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('isole le lien et le jeton, chacun seul sur sa ligne pour être copié', () => {
    const lines = formatDevEmailPreview(email, 30).split('\n');

    expect(lines).toContain(email.resetUrl);
    expect(lines).toContain('abc_DEF-123');
  });

  it('reprend l’objet et le texte de l’e-mail dans la langue du compte', () => {
    const preview = formatDevEmailPreview(email, 30);
    const template = passwordResetTemplate('fr', email.resetUrl, 30);

    expect(preview).toContain(template.subject);
    expect(preview).toContain(template.text);
    expect(preview).toContain('30 minutes');
  });

  it('masque l’adresse du destinataire', () => {
    const preview = formatDevEmailPreview(email, 30);

    expect(preview).toContain('a***@gmail.com');
    expect(preview).not.toContain(email.to);
    expect(maskEmailAddress('sans-arobase')).toBe('***');
    expect(maskEmailAddress('@example.com')).toBe('***');
  });

  it('n’invente pas de jeton quand le lien n’en porte pas', () => {
    const preview = formatDevEmailPreview({ ...email, resetUrl: 'pas une url' }, 30);

    expect(preview).not.toContain('Jeton seul');
    expect(preview.split('\n')).toContain('pas une url');
  });

  it.each(['console', 'noop'] as const)(
    'affiche l’e-mail avec EMAIL_PROVIDER=%s',
    async (provider) => {
      useDevelopment(provider);
      const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

      await getMailer().sendPasswordReset(email);

      expect(info).toHaveBeenCalledTimes(1);
      expect(String(info.mock.calls[0]?.[0])).toContain(email.resetUrl);
    },
  );

  it('signale en développement une demande sans compte, adresse masquée', () => {
    useDevelopment('console');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    reportPasswordResetWithoutAccount(email.to);

    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toContain('a***@gmail.com');
    expect(String(info.mock.calls[0]?.[0])).not.toContain(email.to);
  });

  it('ne signale jamais une demande sans compte hors développement', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    reportPasswordResetWithoutAccount(email.to);
    process.env = { ...previousEnv, NODE_ENV: 'production' };
    resetServerEnvCache();
    reportPasswordResetWithoutAccount(email.to);

    expect(info).not.toHaveBeenCalled();
  });

  it('reste silencieux hors développement avec le transport par défaut', async () => {
    process.env['EMAIL_PROVIDER'] = 'noop';
    resetServerEnvCache();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await getMailer().sendPasswordReset(email);

    expect(info).not.toHaveBeenCalled();
  });
});

describe('contrôle de configuration de production', () => {
  it('ne signale rien hors production', () => {
    expect(
      productionReadinessIssues({
        NODE_ENV: 'development',
        EMAIL_PROVIDER: 'noop',
        EMAIL_PROVIDER_API_KEY: '',
        EMAIL_FROM: '',
        IMPORT_PREVIEW_STORE: 'memory',
        RATE_LIMIT_STORE: 'memory',
      }),
    ).toEqual([]);
  });

  it('refuse en production un magasin en mémoire et un e-mail non configuré', () => {
    const issues = productionReadinessIssues({
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'noop',
      EMAIL_PROVIDER_API_KEY: '',
      EMAIL_FROM: '',
      IMPORT_PREVIEW_STORE: 'memory',
      RATE_LIMIT_STORE: 'memory',
    });

    expect(issues.map((issue) => issue.variable).sort()).toEqual([
      'EMAIL_PROVIDER',
      'IMPORT_PREVIEW_STORE',
      'RATE_LIMIT_STORE',
    ]);
  });

  it('accepte une configuration de production complète', () => {
    expect(
      productionReadinessIssues({
        NODE_ENV: 'production',
        EMAIL_PROVIDER: 'resend',
        EMAIL_PROVIDER_API_KEY: 'cle',
        EMAIL_FROM: 'no-reply@example.com',
        IMPORT_PREVIEW_STORE: 'postgres',
        RATE_LIMIT_STORE: 'postgres',
      }),
    ).toEqual([]);
  });

  it('empêche le démarrage plutôt que de servir du trafic non protégé', () => {
    expect(() =>
      assertProductionReady({
        NODE_ENV: 'production',
        EMAIL_PROVIDER: 'resend',
        EMAIL_PROVIDER_API_KEY: 'cle',
        EMAIL_FROM: 'no-reply@example.com',
        IMPORT_PREVIEW_STORE: 'postgres',
        RATE_LIMIT_STORE: 'memory',
      }),
    ).toThrow(/RATE_LIMIT_STORE/);
  });

  it('ne cite que des noms de variables, jamais des valeurs', () => {
    const issues = productionReadinessIssues({
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'resend',
      EMAIL_PROVIDER_API_KEY: '',
      EMAIL_FROM: 'secret-expediteur@example.com',
      IMPORT_PREVIEW_STORE: 'postgres',
      RATE_LIMIT_STORE: 'postgres',
    });

    const serialized = JSON.stringify(issues);

    expect(serialized).toContain('EMAIL_PROVIDER_API_KEY');
    expect(serialized).not.toContain('secret-expediteur@example.com');
  });
});

describe('lien de réinitialisation', () => {
  it('encode le token dans le lien profond', () => {
    process.env['PASSWORD_RESET_URL_BASE'] = 'subscription-manager://reset-password';
    resetServerEnvCache();

    expect(buildPasswordResetUrl('a b/c')).toBe(
      'subscription-manager://reset-password?token=a%20b%2Fc',
    );
  });
});
