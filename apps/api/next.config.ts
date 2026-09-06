import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

/**
 * Configuration Next.js de `apps/api`.
 *
 * Cette application est **une API**, plus un strict minimum de pages publiques
 * légales (CLAUDE.md §2.2) : politique de confidentialité, CGU, cookies, aide,
 * contact. Il n'y a pas de site marketing — le produit est l'application
 * mobile.
 */
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Le monorepo est transpilé depuis les sources TypeScript : `packages/shared`
  // n'a pas d'étape de build (CLAUDE.md §10.1).
  transpilePackages: ['@subscription-manager/shared'],

  // Les erreurs de typage font échouer le build : `npm run build` ne doit
  // jamais masquer ce que `npm run typecheck` refuserait.
  typescript: { ignoreBuildErrors: false },

  // ESLint n'est pas rejoué ici : la configuration plate du monorepo couvre
  // les trois workspaces d'un coup (`npm run lint`), et la CI l'exécute comme
  // une étape à part entière. Le relancer depuis `next build` ne verrait que
  // `apps/api`, avec une configuration partielle.
  eslint: { ignoreDuringBuilds: true },

  // Next attend une valeur ou une promesse : renvoyer directement le
  // tableau evite une fonction asynchrone sans point d'attente.
  headers() {
    return Promise.resolve([
      {
        // En-têtes appliqués aux pages publiques comme aux routes d'API.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Aucune de ces API n'est utilisée par les pages légales.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]);
  },
};

export default withNextIntl(nextConfig);
