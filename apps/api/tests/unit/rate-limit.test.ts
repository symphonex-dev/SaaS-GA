import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  consumeRateLimit,
  createMemoryRateLimitStore,
  getRateLimitRule,
  rateLimitKey,
  resetRateLimits,
  setRateLimitStoreForTests,
  type RateLimitStore,
} from '@/lib/security/rate-limit';

/** `specs/auth-comptes-rgpd.md` §10 — rate limiting distinct par domaine. */
describe('rate limiting', () => {
  beforeEach(() => {
    resetRateLimits();
    setRateLimitStoreForTests(null);
  });

  afterEach(() => {
    setRateLimitStoreForTests(null);
  });

  it("autorise les tentatives jusqu'à la limite du domaine", async () => {
    const { limit } = getRateLimitRule('auth:login');

    for (let attempt = 0; attempt < limit; attempt += 1) {
      expect((await consumeRateLimit('auth:login', '10.0.0.1')).allowed).toBe(true);
    }

    expect((await consumeRateLimit('auth:login', '10.0.0.1')).allowed).toBe(false);
  });

  it('indique un délai de réessai positif une fois la limite atteinte', async () => {
    const { limit } = getRateLimitRule('auth:register');

    for (let attempt = 0; attempt < limit; attempt += 1) {
      await consumeRateLimit('auth:register', '10.0.0.2');
    }

    const blocked = await consumeRateLimit('auth:register', '10.0.0.2');

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('compte séparément deux identifiants du même domaine', async () => {
    const { limit } = getRateLimitRule('auth:login');

    for (let attempt = 0; attempt < limit; attempt += 1) {
      await consumeRateLimit('auth:login', '10.0.0.3');
    }

    expect((await consumeRateLimit('auth:login', '10.0.0.3')).allowed).toBe(false);
    expect((await consumeRateLimit('auth:login', '10.0.0.4')).allowed).toBe(true);
  });

  it('compte séparément deux domaines pour le même identifiant', async () => {
    const { limit } = getRateLimitRule('auth:login');

    for (let attempt = 0; attempt < limit; attempt += 1) {
      await consumeRateLimit('auth:login', 'partage');
    }

    expect((await consumeRateLimit('auth:login', 'partage')).allowed).toBe(false);
    expect((await consumeRateLimit('auth:reset', 'partage')).allowed).toBe(true);
  });

  it('réouvre le quota à la fin de la fenêtre', async () => {
    const rule = getRateLimitRule('auth:login');
    const start = 1_000_000;

    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      await consumeRateLimit('auth:login', '10.0.0.5', start);
    }

    expect((await consumeRateLimit('auth:login', '10.0.0.5', start)).allowed).toBe(false);
    expect(
      (await consumeRateLimit('auth:login', '10.0.0.5', start + rule.windowMs + 1)).allowed,
    ).toBe(true);
  });

  it('couvre tous les domaines sensibles listés par la spec', () => {
    for (const domain of [
      'auth:login',
      'auth:register',
      'auth:reset',
      'import:upload',
      'ai:user',
      'api:general',
      'store-notifications',
    ] as const) {
      expect(getRateLimitRule(domain).limit).toBeGreaterThan(0);
    }
  });
});

/**
 * Compteur **partagé entre instances** (CLAUDE.md §10.11).
 *
 * C'est la correction structurante : en mémoire de process, N instances
 * autorisent N fois la limite annoncée, ce qui vide la protection de son sens.
 */
describe('compteur partagé multi-instance', () => {
  afterEach(() => {
    setRateLimitStoreForTests(null);
  });

  it('fait converger deux instances vers la même limite', async () => {
    // Un seul magasin, deux appelants : c'est la topologie d'un déploiement à
    // plusieurs process derrière un répartiteur de charge.
    const shared = createMemoryRateLimitStore();

    setRateLimitStoreForTests(shared);

    const { limit } = getRateLimitRule('auth:login');
    const results: boolean[] = [];

    for (let attempt = 0; attempt < limit + 4; attempt += 1) {
      results.push((await consumeRateLimit('auth:login', '10.0.0.9')).allowed);
    }

    expect(results.filter(Boolean)).toHaveLength(limit);
    expect(results.slice(limit)).toEqual([false, false, false, false]);
  });

  it('bâtit une clé déterministe, portant la fenêtre courante', () => {
    const rule = getRateLimitRule('api:general');
    const start = 5 * rule.windowMs;

    expect(rateLimitKey('api:general', 'usr_1', start)).toBe(`api:general:usr_1:${String(start)}`);
    // Deux instants de la même fenêtre partagent la clé : c'est ce qui permet
    // à deux process de compter ensemble.
    expect(rateLimitKey('api:general', 'usr_1', start + rule.windowMs - 1)).toBe(
      rateLimitKey('api:general', 'usr_1', start),
    );
    // La fenêtre suivante a sa propre clé : rien à remettre à zéro.
    expect(rateLimitKey('api:general', 'usr_1', start + rule.windowMs)).not.toBe(
      rateLimitKey('api:general', 'usr_1', start),
    );
  });

  it('sérialise des consommations concurrentes sans dépasser la limite', async () => {
    const shared = createMemoryRateLimitStore();

    setRateLimitStoreForTests(shared);

    const { limit } = getRateLimitRule('auth:login');
    const attempts = Array.from({ length: limit + 10 }, () =>
      consumeRateLimit('auth:login', '10.0.0.10'),
    );

    const results = await Promise.all(attempts);

    expect(results.filter((result) => result.allowed)).toHaveLength(limit);
  });

  it('autorise la requête plutôt que de casser l’API si le magasin est en panne', async () => {
    const failing: RateLimitStore = {
      increment: () => Promise.reject(new Error('base injoignable')),
    };

    setRateLimitStoreForTests(failing);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await consumeRateLimit('auth:login', '10.0.0.11');

    expect(result.allowed).toBe(true);

    // L'incident est signalé, mais sans l'identifiant : il peut porter une
    // adresse IP ou un `userId` (CLAUDE.md §6).
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).not.toContain('10.0.0.11');

    spy.mockRestore();
  });
});
