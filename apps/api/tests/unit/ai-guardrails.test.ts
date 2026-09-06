import { aiResponseSchema } from '@subscription-manager/shared';
import { describe, expect, it } from 'vitest';

import type { AiContext } from '@/server/ai/ai.context';
import { safeFallbackResponse, validateAiOutput } from '@/server/ai/ai.guardrails';
import {
  AI_SYSTEM_PROMPT,
  AI_SYSTEM_PROMPT_VERSION,
  buildSystemPrompt,
} from '@/server/ai/ai.prompt';
import {
  ForbiddenContextFieldError,
  assertContextIsRedacted,
  redactAiContext,
  serializeAiContext,
} from '@/server/ai/ai.redaction';
import { extractJsonObject, parseAiResponse } from '@/server/ai/ai.schemas';

/**
 * Garde-fous de l'assistant IA
 * (`specs/comparateur-et-assistant-ia.md` B.5, B.6, B.7, checklist B.9).
 */
function context(overrides: Partial<AiContext> = {}): AiContext {
  return {
    locale: 'fr',
    currency: 'EUR',
    month: '2026-06',
    monthlyTotal: '129.90',
    previousMonthlyTotal: '104.50',
    topCategories: [{ category: 'STREAMING', amount: '45.97' }],
    newRecurringExpenses: [{ merchant: 'Netflix', amount: '15.99' }],
    priceIncreases: [{ merchant: 'Spotify', previousAmount: '9.99', currentAmount: '11.99' }],
    cancelledExpenses: [{ merchant: 'Deezer' }],
    ...overrides,
  };
}

function validOutput(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    answer: 'Vos dépenses de juin s’élèvent à 129,90 €.',
    uncertainty: 'LOW',
    referencedExpenseIds: [],
    ...overrides,
  });
}

describe('rédaction du contexte (B.5)', () => {
  it('ne transmet que les champs de la liste blanche', () => {
    const polluted = {
      ...context(),
      passwordHash: 'hash',
      sessionToken: 'token',
      userId: 'usr_1',
    } as AiContext;

    const redacted = redactAiContext(polluted);

    expect(Object.keys(redacted).sort()).toEqual([
      'cancelledExpenses',
      'currency',
      'locale',
      'month',
      'monthlyTotal',
      'newRecurringExpenses',
      'previousMonthlyTotal',
      'priceIncreases',
      'topCategories',
    ]);
  });

  it('sérialise un contexte propre sans aucun champ interdit', () => {
    const serialized = serializeAiContext(context());
    const parsed = JSON.parse(serialized) as Record<string, unknown>;

    for (const forbidden of ['passwordHash', 'token', 'sessionToken', 'userId', 'email', 'id']) {
      expect(parsed[forbidden]).toBeUndefined();
    }

    expect(serialized).not.toContain('usr_');
    expect(serialized).not.toContain('@');
  });

  it('refuse un objet portant un nom de champ interdit', () => {
    expect(() => {
      assertContextIsRedacted({ passwordHash: 'x' });
    }).toThrow(ForbiddenContextFieldError);

    expect(() => {
      assertContextIsRedacted({ nested: [{ storeTransactionId: 'GPA.1234' }] });
    }).toThrow(ForbiddenContextFieldError);
  });

  it('refuse une valeur qui ressemble à un jeton', () => {
    expect(() => {
      assertContextIsRedacted({ merchant: 'a'.repeat(64) });
    }).toThrow(ForbiddenContextFieldError);

    expect(() => {
      assertContextIsRedacted({ merchant: 'Bearer abc.def' });
    }).toThrow(ForbiddenContextFieldError);
  });

  it('laisse passer un long libellé de commerçant sans chiffre', () => {
    // Un faux positif ferait échouer un appel parfaitement légitime.
    expect(() => {
      assertContextIsRedacted({ merchant: 'SUPERMARCHECARREFOURCITYPARISCENTREVILLE' });
    }).not.toThrow();
  });
});

describe('prompt système (B.6)', () => {
  it('est versionné', () => {
    expect(AI_SYSTEM_PROMPT_VERSION).toBe('v1-bounded');
  });

  it('énonce les interdits du périmètre V1', () => {
    expect(AI_SYSTEM_PROMPT).toContain('Never invent transactions');
    expect(AI_SYSTEM_PROMPT).toContain('Never provide investment advice');
    expect(AI_SYSTEM_PROMPT).toContain('Never translate');
  });

  it('n’expose que les trois tâches autorisées', () => {
    for (const task of ['MONTHLY_SUMMARY', 'EXPLAIN_INCREASE', 'RECOMMENDATION'] as const) {
      expect(buildSystemPrompt(task, 'fr')).toContain('Respond only in French.');
    }
  });
});

describe('validation de sortie (B.7)', () => {
  it('accepte une sortie conforme', () => {
    const result = validateAiOutput(validOutput(), []);

    expect(result.ok).toBe(true);
  });

  it('extrait le JSON même entouré de texte', () => {
    expect(extractJsonObject('Voici :\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('aucun json ici')).toBeUndefined();
  });

  it('rejette une sortie qui n’est pas du JSON', () => {
    const result = validateAiOutput('Bonjour, voici votre résumé.', []);

    expect(result).toEqual({ ok: false, reason: 'SCHEMA' });
  });

  it('rejette une sortie hors schéma', () => {
    expect(validateAiOutput(validOutput({ uncertainty: 'PEUT_ETRE' }), [])).toEqual({
      ok: false,
      reason: 'SCHEMA',
    });

    expect(validateAiOutput(validOutput({ answer: '' }), [])).toEqual({
      ok: false,
      reason: 'SCHEMA',
    });

    expect(validateAiOutput(validOutput({ answer: 'x'.repeat(1201) }), [])).toEqual({
      ok: false,
      reason: 'SCHEMA',
    });
  });

  it('rejette une référence à une dépense non fournie', () => {
    expect(validateAiOutput(validOutput({ referencedExpenseIds: ['exp_inconnue'] }), [])).toEqual({
      ok: false,
      reason: 'UNKNOWN_EXPENSE_REFERENCE',
    });

    expect(
      validateAiOutput(validOutput({ referencedExpenseIds: ['exp_1'] }), ['exp_1']),
    ).toMatchObject({ ok: true });
  });

  it('rejette un contenu relevant d’un usage hors périmètre', () => {
    const horsPerimetre = [
      'You should invest your savings in an index fund.',
      'Voici un conseil en investissement pour vos économies.',
      'Your credit score will improve if you do this.',
      'We guarantee savings of 200 EUR per year.',
      'Cancel your subscription to Netflix right now.',
      'Résiliez votre abonnement Netflix dès aujourd’hui.',
    ];

    for (const answer of horsPerimetre) {
      expect(validateAiOutput(validOutput({ answer }), [])).toEqual({
        ok: false,
        reason: 'OUT_OF_SCOPE_CONTENT',
      });
    }
  });

  it('laisse passer un résumé ordinaire mentionnant des économies', () => {
    const result = validateAiOutput(
      validOutput({ answer: 'Une économie de 96,00 € par an a été identifiée sur Netflix.' }),
      [],
    );

    expect(result.ok).toBe(true);
  });

  it('renvoie une réponse de repli statique, valide et sans chiffre inventé', () => {
    for (const locale of ['en', 'fr', 'es'] as const) {
      const fallback = safeFallbackResponse(locale);

      expect(aiResponseSchema.safeParse(fallback).success).toBe(true);
      expect(fallback.uncertainty).toBe('HIGH');
      expect(fallback.referencedExpenseIds).toEqual([]);
      expect(fallback.answer).not.toMatch(/\d/);
    }
  });

  it('analyse une sortie brute sans jamais la réparer', () => {
    expect(parseAiResponse('{"answer":"ok"}')).toEqual({ ok: false, failure: 'SCHEMA' });
    expect(parseAiResponse('pas du json')).toEqual({ ok: false, failure: 'NOT_JSON' });
  });
});
