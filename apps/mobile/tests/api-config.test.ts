import { describe, expect, it } from 'vitest';

import {
  ANDROID_EMULATOR_HOST,
  DEFAULT_API_PORT,
  hostnameFromHostUri,
  normalizeBaseUrl,
  resolveApiBaseUrl,
} from '../lib/api-config';

/**
 * Résolution de l'URL de l'API (mission §2 et §22).
 *
 * La règle testée ici est celle qui a cassé la recette : `localhost` ne désigne
 * pas la même machine selon le contexte d'exécution. Sur un téléphone
 * physique, il désigne le téléphone — jamais l'ordinateur qui fait tourner
 * Next.js.
 */
describe("résolution de l'URL de l'API", () => {
  it('donne la priorité absolue à EXPO_PUBLIC_API_BASE_URL', () => {
    const resolution = resolveApiBaseUrl({
      envUrl: 'https://api.example.com',
      extraUrl: 'http://ignored:3000',
      hostUri: '192.168.1.24:8081',
      platform: 'android',
    });

    expect(resolution).toEqual({
      baseUrl: 'https://api.example.com',
      source: 'EXPO_PUBLIC_API_BASE_URL',
    });
  });

  it("retient extra.apiBaseUrl quand la variable d'environnement est absente", () => {
    const resolution = resolveApiBaseUrl({
      envUrl: undefined,
      extraUrl: 'http://10.1.2.3:3000',
      hostUri: '192.168.1.24:8081',
      platform: 'ios',
    });

    expect(resolution).toEqual({
      baseUrl: 'http://10.1.2.3:3000',
      source: 'expoConfig.extra.apiBaseUrl',
    });
  });

  it('ignore une valeur vide ou blanche et poursuit la résolution', () => {
    const resolution = resolveApiBaseUrl({
      envUrl: '   ',
      extraUrl: '',
      hostUri: '192.168.1.24:8081',
      platform: 'android',
    });

    expect(resolution.source).toBe('metro-host');
  });

  it('retire les barres obliques de fin', () => {
    expect(normalizeBaseUrl('https://api.example.com///')).toBe('https://api.example.com');

    const resolution = resolveApiBaseUrl({
      envUrl: 'https://api.example.com/',
      platform: 'android',
    });

    expect(resolution.baseUrl).toBe('https://api.example.com');
  });

  it("déduit l'adresse LAN de l'hôte Metro pour un appareil Android physique", () => {
    const resolution = resolveApiBaseUrl({
      extraUrl: null,
      hostUri: '192.168.1.24:8081',
      platform: 'android',
    });

    expect(resolution).toEqual({
      baseUrl: `http://192.168.1.24:${String(DEFAULT_API_PORT)}`,
      source: 'metro-host',
    });
  });

  it('déduit la même adresse LAN pour un appareil iOS physique', () => {
    const resolution = resolveApiBaseUrl({
      hostUri: 'exp://192.168.1.24:8081',
      platform: 'ios',
    });

    expect(resolution.baseUrl).toBe(`http://192.168.1.24:${String(DEFAULT_API_PORT)}`);
  });

  it("retombe sur 10.0.2.2 pour l'émulateur Android joint en boucle locale", () => {
    const resolution = resolveApiBaseUrl({
      hostUri: 'localhost:8081',
      platform: 'android',
    });

    expect(resolution).toEqual({
      baseUrl: `http://${ANDROID_EMULATOR_HOST}:${String(DEFAULT_API_PORT)}`,
      source: 'android-emulator-fallback',
    });
  });

  it('retombe sur 10.0.2.2 sur Android quand aucun hôte Metro n’est connu', () => {
    const resolution = resolveApiBaseUrl({ hostUri: null, platform: 'android' });

    expect(resolution.source).toBe('android-emulator-fallback');
  });

  it('retombe sur localhost pour le simulateur iOS', () => {
    const resolution = resolveApiBaseUrl({ hostUri: '127.0.0.1:8081', platform: 'ios' });

    expect(resolution).toEqual({
      baseUrl: `http://localhost:${String(DEFAULT_API_PORT)}`,
      source: 'localhost-fallback',
    });
  });

  it('retombe sur localhost pour un navigateur', () => {
    const resolution = resolveApiBaseUrl({ hostUri: 'localhost:8081', platform: 'web' });

    expect(resolution.baseUrl).toBe(`http://localhost:${String(DEFAULT_API_PORT)}`);
  });

  it('respecte un port d’API différent', () => {
    const resolution = resolveApiBaseUrl({
      hostUri: '192.168.0.10:8081',
      platform: 'android',
      port: 4000,
    });

    expect(resolution.baseUrl).toBe('http://192.168.0.10:4000');
  });
});

describe("extraction du nom d'hôte Metro", () => {
  it.each([
    ['192.168.1.24:8081', '192.168.1.24'],
    ['exp://192.168.1.24:8081', '192.168.1.24'],
    ['http://192.168.1.24:8081/_expo', '192.168.1.24'],
    ['localhost:8081', 'localhost'],
    ['tunnel.exp.direct', 'tunnel.exp.direct'],
    ['[fe80::1]:8081', 'fe80::1'],
  ])('%s → %s', (input, expected) => {
    expect(hostnameFromHostUri(input)).toBe(expected);
  });

  it('renvoie null quand aucun hôte n’est disponible', () => {
    expect(hostnameFromHostUri(null)).toBeNull();
    expect(hostnameFromHostUri(undefined)).toBeNull();
    expect(hostnameFromHostUri('')).toBeNull();
  });

  it("entoure une adresse IPv6 de crochets dans l'URL produite", () => {
    const resolution = resolveApiBaseUrl({ hostUri: '[fe80::1]:8081', platform: 'ios' });

    expect(resolution.baseUrl).toBe(`http://[fe80::1]:${String(DEFAULT_API_PORT)}`);
  });
});
