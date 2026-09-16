import type {
  AuthenticatedSessionDto,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from '@subscription-manager/shared';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';

import { AuthErrors } from '@/lib/api/errors';
import { getServerEnv } from '@/lib/env/server';
import {
  buildPasswordResetUrl,
  getMailer,
  reportPasswordResetWithoutAccount,
} from '@/lib/mail/mailer';
import { resolveLocale } from '@/lib/mail/templates';
import { hashPassword, verifyPassword } from '@/lib/security/password';
import { generatePasswordResetToken, hashPasswordResetToken } from '@/lib/security/tokens';
import { authSessionRepository } from '@/server/repositories/auth-session.repository';
import { passwordResetTokenRepository } from '@/server/repositories/password-reset-token.repository';
import { userRepository } from '@/server/repositories/user.repository';
import { issueSession } from '@/server/auth/session';
import { subscriptionRepository } from '@/server/repositories/subscription.repository';
import { toUserDto } from '@/server/services/user.service';

/**
 * Service d'authentification (`specs/auth-comptes-rgpd.md` §2 à §5).
 *
 * Invariants :
 *  - aucun mot de passe ni empreinte ne sort de ce service ni n'est journalisé ;
 *  - aucune réponse ne permet de savoir si une adresse e-mail est enregistrée ;
 *  - le token brut de session n'existe que dans la valeur de retour de
 *    `register` et `login`.
 */

/**
 * Empreinte factice, calculée une fois par process sur une valeur aléatoire.
 *
 * Quand l'e-mail est inconnu, la vérification est tout de même exécutée contre
 * cette empreinte : le temps de réponse reste comparable à celui d'un mot de
 * passe erroné, ce qui interdit l'énumération de comptes par mesure de temps
 * (§4). Une constante mal formée ne conviendrait pas : la vérification
 * échouerait immédiatement, sans consommer le même temps de calcul.
 */
let dummyPasswordHash: Promise<string> | null = null;

function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyPasswordHash;
}

/** Code Prisma d'une violation de contrainte d'unicité. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

function passwordResetTtlMs(): number {
  return getServerEnv().AUTH_PASSWORD_RESET_TTL_MINUTES * 60 * 1000;
}

export const authService = {
  /**
   * Inscription (§2) : accepte toute adresse e-mail valide au sens RFC, sans
   * aucun filtrage de domaine. Les préférences viennent de l'onboarding (§6).
   */
  async register(
    input: RegisterInput,
    deviceLabel: string | null,
  ): Promise<AuthenticatedSessionDto> {
    if (await userRepository.emailExists(input.email)) {
      throw AuthErrors.emailAlreadyExists();
    }

    const passwordHash = await hashPassword(input.password);

    try {
      const user = await userRepository.create({
        email: input.email,
        passwordHash,
        language: input.language,
        country: input.country,
        currency: input.currency,
      });

      const session = await issueSession(user.id, deviceLabel);

      return {
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        // Un compte tout juste creee n'a aucun abonnement : l'offre est Free.
        user: toUserDto(user, null),
      };
    } catch (error) {
      // Deux inscriptions concurrentes sur la même adresse : la contrainte
      // d'unicité en base tranche, et l'erreur reste celle attendue par le client.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_VIOLATION
      ) {
        throw AuthErrors.emailAlreadyExists();
      }

      throw error;
    }
  },

  /**
   * Connexion (§4). Un e-mail inconnu et un mot de passe erroné produisent
   * exactement la même erreur `AUTH_INVALID_CREDENTIALS`.
   */
  async login(input: LoginInput, deviceLabel: string | null): Promise<AuthenticatedSessionDto> {
    const user = await userRepository.findActiveByEmail(input.email);

    if (user === null) {
      // Vérification factice : coût de calcul comparable à un compte existant.
      await verifyPassword(input.password, await getDummyPasswordHash());
      throw AuthErrors.invalidCredentials();
    }

    const passwordMatches = await verifyPassword(input.password, user.passwordHash);

    if (!passwordMatches) {
      throw AuthErrors.invalidCredentials();
    }

    const session = await issueSession(user.id, deviceLabel);
    const subscription = await subscriptionRepository.findByUserId(user.id);

    return {
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: toUserDto(user, subscription),
    };
  },

  /**
   * Demande de réinitialisation (§5).
   *
   * Ne renvoie jamais d'information sur l'existence du compte : la route répond
   * le même message générique dans tous les cas.
   */
  async requestPasswordReset(email: string, now: Date = new Date()): Promise<void> {
    const user = await userRepository.findActiveByEmail(email);

    if (user === null) {
      // Réponse inchangée ; seul le terminal de développement le signale.
      reportPasswordResetWithoutAccount(email);
      return;
    }

    // Une nouvelle demande invalide les précédentes encore en attente.
    await passwordResetTokenRepository.invalidatePendingForUser(user.id, now);

    const token = generatePasswordResetToken();

    await passwordResetTokenRepository.create({
      userId: user.id,
      tokenHash: hashPasswordResetToken(token),
      expiresAt: new Date(now.getTime() + passwordResetTtlMs()),
    });

    try {
      await getMailer().sendPasswordReset({
        to: user.email,
        resetUrl: buildPasswordResetUrl(token),
        // Les traductions sont statiques : la langue du compte choisit le
        // gabarit, elle ne produit aucun texte (CLAUDE.md §5.6).
        locale: resolveLocale(user.language),
      });
    } catch (error) {
      // Un échec d'envoi ne doit **jamais** changer la réponse : la route
      // n'appelle le transport que lorsque le compte existe, donc un code
      // d'erreur différent révélerait son existence (§5). L'incident est
      // journalisé sans adresse, sans lien et sans token.
      console.error(
        `Envoi de l'e-mail de réinitialisation en échec : ${
          error instanceof Error ? error.name : typeof error
        }`,
      );
    }
  },

  /**
   * Consommation d'un token de réinitialisation (§5) : usage unique,
   * expiration courte.
   *
   * Durcissement au-delà de la lettre de la spec : toutes les sessions de
   * l'utilisateur sont révoquées après un changement de mot de passe, pour
   * qu'un token de session déjà volé ne survive pas à la reprise en main du
   * compte.
   */
  async resetPassword(input: ResetPasswordInput, now: Date = new Date()): Promise<void> {
    const record = await passwordResetTokenRepository.findByTokenHash(
      hashPasswordResetToken(input.token),
    );

    if (record === null || record.usedAt !== null) {
      throw AuthErrors.resetTokenInvalid();
    }

    if (record.expiresAt <= now) {
      throw AuthErrors.resetTokenExpired();
    }

    const user = await userRepository.findActiveById(record.userId);

    if (user === null) {
      throw AuthErrors.resetTokenInvalid();
    }

    const consumed = await passwordResetTokenRepository.markUsed(record.id, now);

    if (!consumed) {
      // Une requête concurrente a déjà consommé le token.
      throw AuthErrors.resetTokenInvalid();
    }

    await userRepository.updatePasswordHash(user.id, await hashPassword(input.password));
    await authSessionRepository.revokeAllForUser(user.id, now);
  },
};
