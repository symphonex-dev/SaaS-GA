import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import appConfig from '../app.config';
import en from '../locales/en.json';
import es from '../locales/es.json';
import fr from '../locales/fr.json';

/**
 * Vérifications structurelles du code mobile (mission §16, §20, §21 et §27).
 *
 * Elles échouent si une règle produit est contournée par une modification
 * ultérieure : secret serveur embarqué dans le bundle, tracker ajouté, Stripe
 * réintroduit, chatbot libre, ou langue laissée incomplète.
 */
const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIRS = ['app', 'components', 'lib', 'store'];

function sourceFiles(): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        files.push(full);
      }
    }
  }

  for (const dir of SOURCE_DIRS) {
    walk(path.join(ROOT, dir));
  }

  return files;
}

/**
 * Retire les commentaires avant analyse.
 *
 * Ces vérifications portent sur le **code exécuté**, pas sur la documentation :
 * un commentaire qui explique que `AI_API_KEY` reste côté serveur est
 * précisément ce qu'on veut lire dans le dépôt, pas une fuite.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readAll(): { file: string; content: string }[] {
  return sourceFiles().map((file) => ({
    file: path.relative(ROOT, file),
    content: stripComments(fs.readFileSync(file, 'utf8')),
  }));
}

function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix.length === 0 ? key : `${prefix}.${key}`),
  );
}

describe('aucun secret serveur dans le bundle mobile', () => {
  const FORBIDDEN = [
    'DATABASE_URL',
    'DIRECT_DATABASE_URL',
    'AI_API_KEY',
    'APP_STORE_PRIVATE_KEY',
    'APP_STORE_ROOT_CA',
    'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
    'BILLING_CRON_SECRET',
    'ADMIN_EMAILS',
    'AUTH_SESSION_TTL_DAYS',
  ];

  it.each(FORBIDDEN)('ne mentionne jamais %s', (name) => {
    const offenders = readAll()
      .filter(({ content }) => content.includes(name))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("n'expose que des variables EXPO_PUBLIC_* explicitement publiques", () => {
    const allowed = new Set([
      'EXPO_PUBLIC_API_BASE_URL',
      'EXPO_PUBLIC_PLUS_MONTHLY_PRODUCT_ID',
      'EXPO_PUBLIC_PLUS_YEARLY_PRODUCT_ID',
    ]);

    const used = new Set<string>();

    for (const { content } of readAll()) {
      for (const match of content.matchAll(/EXPO_PUBLIC_[A-Z0-9_]+/g)) {
        used.add(match[0]);
      }
    }

    expect([...used].filter((name) => !allowed.has(name))).toEqual([]);
  });

  it("ne lit aucune variable d'environnement serveur", () => {
    const offenders = readAll()
      .filter(({ content }) => /process\.env\.(?!EXPO_PUBLIC_)[A-Z]/.test(content))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe('règles produit non négociables (CLAUDE.md §5, mission §27)', () => {
  it("n'intègre aucun SDK d'analytics ou de publicité", () => {
    const TRACKERS = [
      'firebase',
      'facebook',
      'appsflyer',
      'mixpanel',
      'amplitude',
      'segment.com',
      'google-analytics',
      'gtag',
      'adjust.com',
    ];

    for (const { file, content } of readAll()) {
      const lower = content.toLowerCase();

      for (const tracker of TRACKERS) {
        expect(`${file}:${tracker}:${String(lower.includes(tracker))}`).toBe(
          `${file}:${tracker}:false`,
        );
      }
    }
  });

  it("n'introduit ni Stripe ni passerelle de paiement web", () => {
    const offenders = readAll()
      .filter(({ content }) => /\bstripe\b/i.test(content) || /paypal\.com/i.test(content))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("n'accède ni à Prisma ni à la base de données", () => {
    const offenders = readAll()
      .filter(({ content }) => /@prisma\/client|PrismaClient|postgresql:\/\//.test(content))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("n'appelle jamais un fournisseur d'IA directement", () => {
    const offenders = readAll()
      .filter(({ content }) =>
        /api\.openai\.com|api\.anthropic\.com|generativelanguage/i.test(content),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("n'appelle `fetch` que depuis le client HTTP unique", () => {
    const offenders = readAll()
      .filter(
        ({ file, content }) =>
          file !== path.join('lib', 'api-client.ts') && /\bfetch\(/.test(content),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe('internationalisation (mission §16)', () => {
  it('les trois langues ont exactement les mêmes clés', () => {
    const keys = {
      en: flatten(en).sort(),
      fr: flatten(fr).sort(),
      es: flatten(es).sort(),
    };

    expect(keys.fr).toEqual(keys.en);
    expect(keys.es).toEqual(keys.en);
    expect(keys.en.length).toBeGreaterThan(400);
  });

  it('aucune traduction n’est vide', () => {
    for (const [locale, dictionary] of [
      ['en', en],
      ['fr', fr],
      ['es', es],
    ] as const) {
      const empty = flatten(dictionary).filter((key) => {
        const value = key
          .split('.')
          .reduce<unknown>(
            (node, part) =>
              typeof node === 'object' && node !== null
                ? (node as Record<string, unknown>)[part]
                : undefined,
            dictionary,
          );

        return typeof value !== 'string' || value.trim().length === 0;
      });

      expect(`${locale}:${empty.join(',')}`).toBe(`${locale}:`);
    }
  });
});

describe('modules natifs et Expo Go', () => {
  it('ne charge le SDK d’achat que par un require isolé', () => {
    const offenders = readAll()
      .filter(
        ({ file, content }) =>
          file !== path.join('lib', 'native-purchases.ts') && content.includes('expo-iap'),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('n’importe jamais statiquement le SDK d’achat', () => {
    const module = fs.readFileSync(path.join(ROOT, 'lib/native-purchases.ts'), 'utf8');

    expect(module).not.toMatch(/^import .*expo-iap/m);
    expect(module).toContain("require('expo-iap')");
  });

  it('déclare tout module natif qu’il importe', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    // L'autolinking d'Expo part des dépendances **du projet Expo**. Un module
    // seulement hissé dans `node_modules` est importable en développement et
    // absent du binaire : la panne n'apparaît qu'à l'exécution sur l'appareil
    // (CLAUDE.md §10.12).
    for (const module of ['expo-document-picker', 'expo-file-system', 'expo-secure-store']) {
      expect(Object.keys(manifest.dependencies ?? {})).toContain(module);
    }
  });

  it('n’utilise plus RevenueCat : la facturation est directe (Google/Apple)', () => {
    const offenders = readAll()
      .filter(({ content }) => /react-native-purchases|revenuecat/i.test(content))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);

    const manifest = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');

    expect(manifest).not.toContain('react-native-purchases');
  });
});

/**
 * Build de développement Android (CLAUDE.md §10.12).
 *
 * Ces quatre invariants sont ceux dont la rupture produit un APK qui se fige
 * sur l'écran de démarrage puis déclenche un ANR, **sans aucune erreur de
 * build** : l'APK se construit normalement, il lui manque simplement le
 * lanceur de développement.
 */
describe('build de développement Android', () => {
  interface MobileManifest {
    dependencies?: Record<string, string>;
  }

  interface BuildProfile {
    extends?: string;
    env?: Record<string, string>;
    developmentClient?: boolean;
  }

  function mobileManifest(): MobileManifest {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as MobileManifest;
  }

  function buildProfiles(): Record<string, BuildProfile> {
    const easJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'eas.json'), 'utf8')) as {
      build?: Record<string, BuildProfile>;
    };

    return easJson.build ?? {};
  }

  /** Applique la chaîne `extends` d'un profil EAS, comme le fait EAS Build. */
  function resolvedEnv(profileName: string): Record<string, string> {
    const profiles = buildProfiles();
    const chain: BuildProfile[] = [];
    let name: string | undefined = profileName;

    while (name !== undefined) {
      const profile: BuildProfile | undefined = profiles[name];

      if (profile === undefined) {
        break;
      }

      chain.unshift(profile);
      name = profile.extends;
    }

    return chain.reduce<Record<string, string>>((env, profile) => ({ ...env, ...profile.env }), {});
  }

  it('déclare `expo-dev-client` dans les dépendances de l’application', () => {
    // L'autolinking d'Expo part des dépendances **du projet Expo**, pas de ce
    // qui traîne dans `node_modules`. Déclaré au seul niveau du monorepo, le
    // paquet est bien installé mais ni `expo-dev-launcher` ni `expo-dev-menu`
    // ne sont liés : l'APK `developmentClient: true` démarre alors sans écran
    // de sélection de serveur, donc sans aucun moyen d'atteindre Metro.
    expect(mobileManifest().dependencies?.['expo-dev-client']).toBeDefined();
  });

  it('ne committe aucun projet natif : le prebuild s’exécute à chaque build', () => {
    // Un dossier `android/` ou `ios/` présent fait sauter `expo prebuild` côté
    // EAS. La configuration native se fige à la date du dernier prebuild local
    // et toute modification ultérieure de `app.config.ts` — plugin, icône,
    // permission, dépendance native — est silencieusement ignorée.
    for (const directory of ['android', 'ios']) {
      expect(`${directory}:${String(fs.existsSync(path.join(ROOT, directory)))}`).toBe(
        `${directory}:false`,
      );
    }
  });

  it('ne fige pas l’URL d’API dans le profil de développement', () => {
    const development = buildProfiles()['development'];

    expect(development?.developmentClient).toBe(true);
    // `EXPO_PUBLIC_API_BASE_URL` gagne sur toute déduction (`lib/api-config.ts`).
    // Fixée ici — y compris héritée d'un profil parent — elle enverrait le build
    // de développement vers une URL figée au lieu de la machine de l'hôte Metro.
    expect(resolvedEnv('development')['EXPO_PUBLIC_API_BASE_URL']).toBeUndefined();
  });

  it('n’écrit jamais d’adresse de boucle locale dans la configuration Expo', () => {
    // `extra` est inliné dans le bundle : une adresse de boucle locale y
    // désignerait le téléphone lui-même, jamais la machine de développement.
    expect(JSON.stringify(appConfig)).not.toMatch(/localhost|127\.0\.0\.1|10\.0\.2\.2/);
  });

  it('n’a qu’une seule politique de `runtimeVersion`, commune aux plateformes', () => {
    expect(appConfig.runtimeVersion).toEqual({ policy: 'appVersion' });
    expect(appConfig.android?.runtimeVersion).toBeUndefined();
    expect(appConfig.ios?.runtimeVersion).toBeUndefined();
  });
});
