import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Stockage temporaire du fichier importé (`specs/import-releves.md` §3 et §11).
 *
 * Le fichier source n'est **jamais** conservé durablement : il est écrit dans
 * un répertoire temporaire isolé, traité, puis supprimé dans un bloc `finally`
 * — y compris lorsque le traitement échoue.
 */
const TEMP_DIRECTORY_NAME = 'subscription-manager-imports';

/**
 * Répertoire de travail des imports.
 *
 * `IMPORT_TEMP_DIR` permet de le déplacer (volume dédié en production, dossier
 * isolé par fichier de test). La variable est lue à chaque appel plutôt que
 * mise en cache : les tests peuvent ainsi cloisonner leur répertoire sans
 * dépendre de l'ordre d'initialisation des modules.
 */
export function importTempDirectory(): string {
  const configured = process.env.IMPORT_TEMP_DIR;

  return configured !== undefined && configured.length > 0
    ? configured
    : join(tmpdir(), TEMP_DIRECTORY_NAME);
}

/**
 * Écrit le contenu dans un fichier temporaire, exécute `handler`, puis supprime
 * le fichier quoi qu'il arrive.
 *
 * Le nom du fichier est aléatoire et ne reprend jamais celui fourni par le
 * client : un nom d'origine peut contenir une tentative de traversée de
 * répertoire (`../../etc/passwd`).
 */
export async function withTemporaryFile<T>(
  content: Buffer,
  extension: string,
  handler: (filePath: string) => Promise<T>,
): Promise<T> {
  const directory = importTempDirectory();
  await mkdir(directory, { recursive: true });

  const filePath = join(directory, `${randomBytes(16).toString('hex')}.${extension}`);

  try {
    await writeFile(filePath, content, { mode: 0o600 });
    return await handler(filePath);
  } finally {
    // `force: true` : l'absence du fichier n'est jamais une erreur, et l'échec
    // de suppression ne doit pas masquer l'erreur de traitement d'origine.
    await rm(filePath, { force: true }).catch(() => undefined);
  }
}

/** Relecture du fichier temporaire — le traitement part toujours du fichier écrit. */
export async function readTemporaryFile(filePath: string): Promise<Buffer> {
  return readFile(filePath);
}
