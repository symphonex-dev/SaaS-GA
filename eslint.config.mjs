import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Configuration ESLint du monorepo (CLAUDE.md §2.2 et §2.3).
 *
 * Mêmes règles pour `apps/api` et `apps/mobile` : les deux partagent
 * `packages/shared`, et une règle qui ne vaudrait que d'un côté finirait par
 * diverger.
 *
 * Le formatage n'est **pas** traité ici : il relève de Prettier seul, exécuté
 * par `npm run format:check`. Dupliquer les règles de style ferait entrer en
 * conflit deux outils sur le même fichier.
 */
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default tseslint.config(
  {
    // Artefacts et code généré : jamais analysés.
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.expo/**',
      '**/dist/**',
      '**/build/**',
      '**/*.tsbuildinfo',
      '**/next-env.d.ts',
      'apps/api/prisma/migrations/**',
      // Script Node autonome, execute a la main pour regenerer les icones.
      'apps/mobile/assets/**',
    ],
  },

  js.configs.recommended,

  // Analyse typée : elle seule permet de détecter une promesse non attendue ou
  // un `any` qui traverse une frontière (CLAUDE.md §2.6).
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `unknown` + narrowing explicite plutôt qu'`any` (CLAUDE.md §2.6).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // Une promesse oubliée dans un handler d'API laisse une écriture en vol.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',

      // Les variables inutilisées signalent souvent un branchement oublié ;
      // le préfixe `_` reste admis pour un paramètre volontairement ignoré.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // `==` masque des comparaisons entre types différents.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },

  // Application mobile : règles React et interdiction d'accéder au serveur.
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /**
       * Cloisonnement du mobile (CLAUDE.md §2.3) : ni Prisma, ni base de
       * données, ni configuration serveur ne doivent pouvoir être importés.
       * Ce sont les chemins par lesquels une clé secrète finirait dans le
       * bundle.
       */
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@prisma/client', '**/lib/db/*', '**/lib/env/server*', '**/server/**'],
              message:
                'Le mobile ne parle jamais à la base ni à la configuration serveur (CLAUDE.md §2.3).',
            },
          ],
        },
      ],
    },
  },

  // Pages publiques de `apps/api` : règles Next.js.
  ...compat.extends('next/core-web-vitals').map((config) => ({
    ...config,
    files: ['apps/api/**/*.{ts,tsx}'],
    settings: { ...config.settings, next: { rootDir: 'apps/api' } },
  })),

  {
    // Les tests exercent volontairement des entrées hostiles et mal typées.
    files: ['apps/api/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  {
    /**
     * Fichiers de configuration en CommonJS (Babel, Metro, Tailwind) : hors du
     * programme TypeScript, et exécutés par Node — `module`, `require` et
     * `__dirname` y sont légitimes.
     */
    files: ['**/*.mjs', '**/*.js', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: {
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      // Les regles typees sont desactivees en bloc, puis on ecarte ce qui
      // reste inadapte a un fichier de configuration CommonJS.
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
