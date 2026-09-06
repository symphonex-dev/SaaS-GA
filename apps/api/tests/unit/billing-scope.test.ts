import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLANS, PLANS_REFERENCE_CURRENCY } from '@subscription-manager/shared';
import { describe, expect, it } from 'vitest';

/**
 * Checklist d'acceptation du paiement in-app
 * (`specs/paiement-in-app.md` §11), vérifiée sur le code lui-même.
 */
const API_SRC = fileURLToPath(new URL('../../src', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

function filesUnder(directory: string, extensions: readonly string[]): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return entry === 'node_modules' ? [] : filesUnder(path, extensions);
    }

    return extensions.some((extension) => path.endsWith(extension)) ? [path] : [];
  });
}

describe('aucune trace de Stripe (§11)', () => {
  const sources = [
    ...filesUnder(API_SRC, ['.ts', '.tsx']),
    ...filesUnder(join(REPO_ROOT, 'packages', 'shared'), ['.ts']),
    ...filesUnder(join(REPO_ROOT, 'apps', 'mobile', 'lib'), ['.ts']),
    join(REPO_ROOT, '.env.example'),
    join(REPO_ROOT, 'apps', 'api', 'prisma', 'schema.prisma'),
  ];

  /**
   * Usages réels de Stripe : import de module, variable d'environnement,
   * champ de schéma, appel de SDK.
   *
   * Les mentions en prose (« aucune intégration Stripe ») sont volontairement
   * hors périmètre : ce sont elles qui documentent l'interdiction.
   */
  const STRIPE_USAGE = [
    /from ['"]stripe['"]/i,
    /require\(['"]stripe['"]\)/i,
    /STRIPE_[A-Z_]+/,
    /stripe[A-Z]\w*/,
    /\bstripe\.\w/i,
  ];

  it('n’apparaît ni dans le code, ni dans les variables, ni dans le schéma', () => {
    const offenders = sources.filter((path) => {
      const content = readFileSync(path, 'utf8');

      return STRIPE_USAGE.some((pattern) => pattern.test(content));
    });

    expect(offenders).toEqual([]);
  });

  it('ne déclare aucune dépendance de paiement web', () => {
    for (const manifest of [
      join(REPO_ROOT, 'package.json'),
      join(REPO_ROOT, 'apps', 'api', 'package.json'),
      join(REPO_ROOT, 'apps', 'mobile', 'package.json'),
      join(REPO_ROOT, 'packages', 'shared', 'package.json'),
    ]) {
      expect(readFileSync(manifest, 'utf8')).not.toMatch(/stripe|braintree|paddle/i);
    }
  });
});

describe('secrets des stores confinés au serveur (§3)', () => {
  const STORE_SECRETS = [
    'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
    'APP_STORE_PRIVATE_KEY',
    'GOOGLE_PLAY_PUBSUB_VERIFICATION_TOKEN',
    'BILLING_CRON_SECRET',
  ];

  it('n’expose aucun secret de store au code mobile', () => {
    const mobileFiles = [
      ...filesUnder(join(REPO_ROOT, 'apps', 'mobile', 'lib'), ['.ts']),
      // La configuration Expo est typée depuis la correction de la recette
      // mobile : `app.json` a été remplacé par `app.config.ts`, qui lit l'URL
      // d'API dans une variable publique et n'a accès à aucun secret.
      join(REPO_ROOT, 'apps', 'mobile', 'app.config.ts'),
    ];

    for (const path of mobileFiles) {
      const content = readFileSync(path, 'utf8');

      for (const secret of STORE_SECRETS) {
        expect(content).not.toContain(secret);
      }
    }
  });

  it('ne lit les secrets des stores que dans les modules de facturation serveur', () => {
    const readers = filesUnder(API_SRC, ['.ts'])
      .filter((path) => {
        const content = readFileSync(path, 'utf8');

        return STORE_SECRETS.some((secret) => content.includes(secret));
      })
      .map((path) => path.replace(/\\/g, '/').split('/src/')[1])
      .sort();

    expect(readers).toEqual([
      'app/api/billing/expire-overdue/route.ts',
      'app/api/webhooks/google-play/route.ts',
      'lib/billing/app-store.ts',
      'lib/billing/google-play.ts',
      'lib/env/server.ts',
    ]);
  });
});

describe('entitlements centralisés côté serveur (§7 et §11)', () => {
  it('ne duplique la matrice des droits dans aucun fichier mobile', () => {
    const mobileFiles = filesUnder(join(REPO_ROOT, 'apps', 'mobile'), ['.ts', '.tsx']).filter(
      (path) => !path.includes('node_modules'),
    );

    for (const path of mobileFiles) {
      const content = readFileSync(path, 'utf8');

      // Les noms d'entitlements ne doivent exister que côté serveur : le
      // mobile reçoit des droits déjà résolus, il ne les recalcule jamais.
      expect(content).not.toContain('maxCsvImportsPerMonth');
      expect(content).not.toContain('pdfImportEnabled');
      expect(content).not.toContain('aiMonthlyCredits');
    }
  });

  it('ne définit la matrice qu’une seule fois', () => {
    // Le deux-points distingue la **définition** (interface ou littéral) de la
    // simple lecture d'un droit (`entitlements.maxCsvImportsPerMonth`).
    const definitions = filesUnder(API_SRC, ['.ts']).filter((path) =>
      /maxCsvImportsPerMonth\s*:/.test(readFileSync(path, 'utf8')),
    );

    expect(definitions.map((path) => path.replace(/\\/g, '/').split('/src/')[1])).toEqual([
      'server/entitlements/entitlements.ts',
    ]);
  });
});

describe('tarifs de référence (§3)', () => {
  it('sont exprimés en unités mineures entières, jamais en flottant', () => {
    expect(PLANS.PLUS.monthlyPriceMinor).toBe(599n);
    expect(PLANS.PLUS.yearlyPriceMinor).toBe(4999n);
    expect(PLANS.FREE.monthlyPriceMinor).toBe(0n);
    expect(PLANS_REFERENCE_CURRENCY).toBe('EUR');

    for (const value of Object.values(PLANS).flatMap((plan) => Object.values(plan))) {
      expect(typeof value).toBe('bigint');
    }
  });

  it('ne servent jamais de source de facturation', () => {
    // Aucun service ne lit `PLANS` : le prix réel vient du store, et le plan
    // accordé vient de la vérification d'achat.
    const readers = filesUnder(API_SRC, ['.ts']).filter((path) =>
      /\bPLANS\b/.test(readFileSync(path, 'utf8')),
    );

    expect(readers).toEqual([]);
  });
});
