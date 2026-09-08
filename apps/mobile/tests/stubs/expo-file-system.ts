/**
 * Double minimal de `expo-file-system`.
 *
 * Le vrai module charge `expo-modules-core`, qui exige un moteur natif : il
 * n'est pas chargeable hors d'un appareil. Aucun test ne lit ni n'écrit de
 * fichier — un relevé bancaire n'a rien à faire dans une suite de tests, et
 * l'envoi réel relève de la recette sur appareil (`CLAUDE.md` §7 phase 3).
 *
 * Ce double n'existe que pour rendre `lib/api-client.ts` importable : les
 * tests portent sur les descripteurs d'appels et la logique pure, jamais sur
 * le transfert lui-même.
 */
export enum UploadType {
  BINARY_CONTENT = 0,
  MULTIPART = 1,
}

export class Directory {
  constructor(..._uris: unknown[]) {
    // Aucun répertoire n'est créé : le système de fichiers n'est pas sollicité.
  }

  create(): void {
    // Aucun effet.
  }
}

export class File {
  constructor(..._uris: unknown[]) {
    // Aucun fichier n'est ouvert.
  }

  copy(): Promise<void> {
    return Promise.reject(new Error('expo-file-system indisponible hors appareil'));
  }

  upload(): Promise<{ body: string; status: number; headers: Record<string, string> }> {
    return Promise.reject(new Error('expo-file-system indisponible hors appareil'));
  }

  delete(): void {
    // Aucun effet.
  }
}

export const Paths = {
  cache: new Directory('file:///cache'),
  document: new Directory('file:///documents'),
};
