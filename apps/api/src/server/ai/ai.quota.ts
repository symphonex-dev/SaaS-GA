import {
  ERROR_CODES,
  type AiQuotaDto,
  type CommercializedPlan,
} from '@subscription-manager/shared';
import { Prisma } from '@prisma/client';

import { AppError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';
import { getServerEnv } from '@/lib/env/server';

/**
 * Quotas IA (`specs/comparateur-et-assistant-ia.md` B.8).
 *
 * Le quota est consommé par une **requête SQL conditionnelle** : la lecture et
 * l'écriture sont un seul énoncé, verrouillé par la ligne. Deux appels
 * simultanés ne peuvent donc pas dépasser le quota, là où un
 * « lire puis écrire » côté application laisserait passer les deux.
 */
export class AiQuotaExceededError extends AppError {
  constructor() {
    super(ERROR_CODES.AI_QUOTA_EXCEEDED, 'Crédits IA du mois épuisés.');
    this.name = 'AiQuotaExceededError';
  }
}

/** Début de la période mensuelle courante, en UTC. */
export function currentPeriodStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Crédits accordés pour une offre.
 *
 * Valeurs pilotées par l'environnement (B.4), avec pour défaut la matrice
 * d'entitlements (`specs/paiement-in-app.md` §2 : 3 en Free, 30 en Plus).
 */
export function creditsForPlan(plan: CommercializedPlan): number {
  const env = getServerEnv();

  return plan === 'PLUS' ? env.AI_MONTHLY_CREDITS_PLUS : env.AI_MONTHLY_CREDITS_FREE;
}

async function readQuota(
  userId: string,
): Promise<{ periodStart: Date; creditsGranted: number; creditsUsed: number } | null> {
  const row = await prisma.aiQuota.findUnique({ where: { userId } });

  return row === null
    ? null
    : {
        periodStart: row.periodStart,
        creditsGranted: row.creditsGranted,
        creditsUsed: row.creditsUsed,
      };
}

/**
 * Aligne la ligne de quota sur la période et l'offre courantes.
 *
 * Les trois écritures sont conditionnelles et idempotentes : exécutées deux
 * fois en parallèle, la seconde ne touche aucune ligne.
 */
async function ensureQuotaRow(
  userId: string,
  periodStart: Date,
  creditsGranted: number,
): Promise<void> {
  // Bascule de période : remise à zéro des crédits consommés. La condition sur
  // `period_start` garantit qu'un appel concurrent ne remet pas à zéro deux fois.
  await prisma.$executeRaw`
    UPDATE ai_quotas
    SET period_start = ${periodStart}, credits_used = 0, credits_granted = ${creditsGranted}
    WHERE user_id = ${userId} AND period_start <> ${periodStart}
  `;

  // Changement d'offre en cours de mois : le nombre de crédits accordés suit,
  // sans jamais toucher aux crédits déjà consommés.
  await prisma.$executeRaw`
    UPDATE ai_quotas
    SET credits_granted = ${creditsGranted}
    WHERE user_id = ${userId} AND period_start = ${periodStart} AND credits_granted <> ${creditsGranted}
  `;

  if ((await readQuota(userId)) !== null) {
    return;
  }

  try {
    await prisma.aiQuota.create({ data: { userId, periodStart, creditsGranted, creditsUsed: 0 } });
  } catch (error) {
    // Course à la création : une autre requête a inséré la ligne entre-temps.
    // La clé primaire garantit qu'il n'en existe qu'une ; on repart de celle-là.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
  }
}

/**
 * Consomme un crédit, ou lève `AiQuotaExceededError`.
 *
 * L'incrément est conditionnel — `credits_used < credits_granted` fait partie
 * de la clause `WHERE` — donc le dépassement est impossible, y compris sous
 * appels concurrents (B.8). Zéro ligne modifiée signifie quota atteint.
 */
export async function consumeAiCredit(
  userId: string,
  plan: CommercializedPlan,
  now: Date = new Date(),
): Promise<AiQuotaDto> {
  const periodStart = currentPeriodStart(now);
  const creditsGranted = creditsForPlan(plan);

  await ensureQuotaRow(userId, periodStart, creditsGranted);

  const updated = await prisma.$executeRaw`
    UPDATE ai_quotas
    SET credits_used = credits_used + 1
    WHERE user_id = ${userId} AND period_start = ${periodStart} AND credits_used < credits_granted
  `;

  if (updated === 0) {
    throw new AiQuotaExceededError();
  }

  const quota = await readQuota(userId);

  if (quota === null) {
    throw new AiQuotaExceededError();
  }

  return toQuotaDto(quota);
}

/** État courant du quota, sans rien consommer. */
export async function readAiQuota(
  userId: string,
  plan: CommercializedPlan,
  now: Date = new Date(),
): Promise<AiQuotaDto> {
  const periodStart = currentPeriodStart(now);
  const creditsGranted = creditsForPlan(plan);
  const quota = await readQuota(userId);

  if (quota === null || quota.periodStart.getTime() !== periodStart.getTime()) {
    // Aucune ligne, ou ligne d'une période révolue : le quota est plein. Rien
    // n'est écrit ici — une simple lecture ne doit pas modifier la base.
    return {
      periodStart: periodStart.toISOString(),
      creditsGranted,
      creditsUsed: 0,
      creditsRemaining: creditsGranted,
    };
  }

  return toQuotaDto(quota);
}

function toQuotaDto(quota: {
  periodStart: Date;
  creditsGranted: number;
  creditsUsed: number;
}): AiQuotaDto {
  return {
    periodStart: quota.periodStart.toISOString(),
    creditsGranted: quota.creditsGranted,
    creditsUsed: quota.creditsUsed,
    creditsRemaining: Math.max(0, quota.creditsGranted - quota.creditsUsed),
  };
}
