import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const srcPath = fileURLToPath(new URL('./src', import.meta.url));
const prismaMockPath = fileURLToPath(new URL('./tests/helpers/prisma-mock.ts', import.meta.url));

export default defineConfig({
  resolve: {
    // L'ordre compte : l'alias le plus spécifique doit être résolu en premier.
    alias: [
      // Aucun test ne parle à une vraie base : le client Prisma est remplacé
      // par un double en mémoire (voir tests/helpers/prisma-mock.ts).
      { find: '@/lib/db/prisma', replacement: prismaMockPath },
      { find: /^@\//, replacement: `${srcPath}/` },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
  },
});
