import { existsSync } from 'node:fs';
import path from 'node:path';

import { emailSchema, passwordSchema } from '@subscription-manager/shared';

/**
 * Définit directement le mot de passe d'un compte existant.
 *
 * Outil d'exploitation, lancé à la main :
 *
 *   npm run user:set-password --workspace=apps/api -- <adresse> [--dry-run]
 *
 * Le mot de passe n'est **jamais** passé en argument, où il resterait dans
 * l'historique du terminal : il est demandé deux fois, sans écho. Pour un
 * usage non interactif, il est lu dans la variable `NEW_PASSWORD`.
 *
 * Effet identique à une réinitialisation par lien
 * (`authService.resetPassword`) : nouvelle empreinte Argon2id, toutes les
 * sessions révoquées, liens de réinitialisation en attente invalidés. La
 * règle de longueur est celle de l'inscription (`passwordSchema`).
 *
 * La base visée est celle de `DATABASE_URL`, lue dans l'environnement ou, à
 * défaut, dans `apps/api/.env.local` — la même que `next dev`. Son hôte est
 * affiché avant toute écriture : si c'est la base de production, le
 * changement y est immédiat.
 *
 * Rien d'autre n'est affiché que l'adresse masquée, l'hôte de la base et des
 * comptes : ni mot de passe, ni empreinte, ni identifiant de connexion
 * (CLAUDE.md §6).
 */

const API_DIR = path.resolve(__dirname, '..');

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function loadDatabaseUrl(): URL {
  const envFile = path.join(API_DIR, '.env.local');

  if (process.env.DATABASE_URL === undefined && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  const raw = process.env.DATABASE_URL;

  if (raw === undefined || raw.length === 0) {
    fail('DATABASE_URL introuvable (environnement ou apps/api/.env.local).');
  }

  try {
    return new URL(raw);
  } catch {
    fail('DATABASE_URL illisible.');
  }
}

/** Saisie sans écho : les caractères tapés ne sont jamais affichés. */
function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;

  return new Promise((resolve) => {
    let value = '';

    const cleanup = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(value);
          return;
        }

        // Ctrl+C : le mode brut l'intercepte, il faut donc l'honorer ici.
        if (char === '') {
          cleanup();
          fail('Saisie interrompue : rien n’a été modifié.');
        }

        value = char === '' || char === '\b' ? value.slice(0, -1) : value + char;
      }
    };

    stdout.write(question);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function readNewPassword(): Promise<string> {
  const fromEnv = process.env.NEW_PASSWORD;

  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }

  if (!process.stdin.isTTY) {
    fail('Aucun terminal interactif : fournir le mot de passe dans NEW_PASSWORD.');
  }

  const first = await promptHidden('Nouveau mot de passe : ');
  const second = await promptHidden('Confirmer le mot de passe : ');

  if (first !== second) {
    fail('Les deux saisies diffèrent : rien n’a été modifié.');
  }

  return first;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const address = args.find((arg) => !arg.startsWith('--'));

  const email = emailSchema.safeParse(address ?? '');

  if (!email.success) {
    fail('Usage : npm run user:set-password --workspace=apps/api -- <adresse> [--dry-run]');
  }

  const database = loadDatabaseUrl();

  // Imports différés : le client Prisma ne doit être construit qu'une fois
  // `DATABASE_URL` chargée.
  const [{ prisma }, { maskEmailAddress }, { hashPassword }, repositories] = await Promise.all([
    import('@/lib/db/prisma'),
    import('@/lib/mail/mailer'),
    import('@/lib/security/password'),
    Promise.all([
      import('@/server/repositories/user.repository'),
      import('@/server/repositories/auth-session.repository'),
      import('@/server/repositories/password-reset-token.repository'),
    ]),
  ]);
  const [{ userRepository }, { authSessionRepository }, { passwordResetTokenRepository }] =
    repositories;

  try {
    const masked = maskEmailAddress(email.data);

    console.info(`Base visée : ${database.hostname}${database.pathname}`);

    const user = await userRepository.findActiveByEmail(email.data);

    if (user === null) {
      fail(`Aucun compte actif pour ${masked} dans cette base : rien n'a été modifié.`);
    }

    if (dryRun) {
      const sessions = await authSessionRepository.listForUser(user.id);
      const active = sessions.filter((session) => session.revokedAt === null).length;

      console.info(
        `Compte trouvé : ${masked} (${String(active)} session(s) non révoquée(s)). --dry-run : rien n'a été modifié.`,
      );
      return;
    }

    const password = passwordSchema.safeParse(await readNewPassword());

    if (!password.success) {
      fail('Mot de passe refusé : 12 à 128 caractères. Rien n’a été modifié.');
    }

    const now = new Date();

    await userRepository.updatePasswordHash(user.id, await hashPassword(password.data));

    // Comme après une réinitialisation par lien : une session ou un lien déjà
    // émis ne doit pas survivre au changement de mot de passe.
    const revoked = await authSessionRepository.revokeAllForUser(user.id, now);
    const invalidated = await passwordResetTokenRepository.invalidatePendingForUser(user.id, now);

    console.info(
      `Mot de passe mis à jour pour ${masked} : ${String(revoked)} session(s) révoquée(s), ${String(invalidated)} lien(s) de réinitialisation invalidé(s).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Le nom de l'erreur seul : son message peut contenir l'URL de la base.
  console.error(`Échec : ${error instanceof Error ? error.name : typeof error}`);
  process.exitCode = 1;
});
