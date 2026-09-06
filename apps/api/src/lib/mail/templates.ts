import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@subscription-manager/shared';

/**
 * Contenu de l'e-mail de réinitialisation (`specs/auth-comptes-rgpd.md` §5).
 *
 * Traductions **statiques**, versionnées avec le code : aucune génération ni
 * traduction par IA (CLAUDE.md §5.6). Les trois langues du produit sont
 * couvertes ; une locale inconnue retombe sur l'anglais.
 *
 * Le message ne contient que le lien et sa durée de validité. Aucune donnée de
 * compte, aucun montant, aucun identifiant technique : un e-mail transite par
 * des serveurs tiers et peut rester lisible longtemps.
 */
export interface PasswordResetTemplate {
  subject: string;
  text: string;
  html: string;
}

interface TemplateStrings {
  subject: string;
  intro: string;
  action: string;
  validity: (minutes: number) => string;
  ignore: string;
  fallback: string;
}

const STRINGS: Readonly<Record<Locale, TemplateStrings>> = {
  en: {
    subject: 'Reset your password',
    intro: 'You asked to reset the password for your Subscription Manager account.',
    action: 'Reset my password',
    validity: (minutes) =>
      `This link is valid for ${String(minutes)} minutes and can be used once.`,
    ignore: 'If you did not ask for this, you can ignore this message: nothing has changed.',
    fallback: 'If the button does not work, copy this link into your browser:',
  },
  fr: {
    subject: 'Réinitialisez votre mot de passe',
    intro:
      'Vous avez demandé à réinitialiser le mot de passe de votre compte Gestionnaire d’abonnements.',
    action: 'Réinitialiser mon mot de passe',
    validity: (minutes) =>
      `Ce lien est valable ${String(minutes)} minutes et ne peut servir qu’une fois.`,
    ignore:
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : rien n'a changé.",
    fallback: 'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :',
  },
  es: {
    subject: 'Restablece tu contraseña',
    intro: 'Has pedido restablecer la contraseña de tu cuenta de Gestor de suscripciones.',
    action: 'Restablecer mi contraseña',
    validity: (minutes) =>
      `Este enlace es válido durante ${String(minutes)} minutos y solo se puede usar una vez.`,
    ignore: 'Si no lo has pedido tú, ignora este mensaje: no ha cambiado nada.',
    fallback: 'Si el botón no funciona, copia este enlace en tu navegador:',
  },
};

/** Échappe le contenu injecté dans le HTML : le lien vient d'un token aléatoire. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function resolveLocale(value: string): Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
    ? (value as Locale)
    : DEFAULT_LOCALE;
}

export function passwordResetTemplate(
  locale: Locale,
  resetUrl: string,
  validityMinutes: number,
): PasswordResetTemplate {
  const strings = STRINGS[locale];
  const safeUrl = escapeHtml(resetUrl);

  const text = [
    strings.intro,
    '',
    resetUrl,
    '',
    strings.validity(validityMinutes),
    strings.ignore,
  ].join('\n');

  const html = [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#0f172a">',
    `<p>${escapeHtml(strings.intro)}</p>`,
    `<p><a href="${safeUrl}" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none">${escapeHtml(strings.action)}</a></p>`,
    `<p style="font-size:14px;color:#475569">${escapeHtml(strings.validity(validityMinutes))}</p>`,
    `<p style="font-size:14px;color:#475569">${escapeHtml(strings.ignore)}</p>`,
    `<p style="font-size:12px;color:#64748b">${escapeHtml(strings.fallback)}<br>${safeUrl}</p>`,
    '</body></html>',
  ].join('');

  return { subject: strings.subject, text, html };
}
