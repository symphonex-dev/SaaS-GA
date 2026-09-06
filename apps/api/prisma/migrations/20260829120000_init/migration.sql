-- Migration initiale — specs/schema-donnees.md
-- 14 enums, 11 tables (9 modèles métier + AiQuota + StoreNotificationEvent).
-- Générée avec : prisma migrate diff --from-empty --to-schema-datamodel
-- Application : npm run db:migrate:deploy --workspace=apps/api

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('FREE', 'PLUS');

-- CreateEnum
CREATE TYPE "ExpenseFrequency" AS ENUM ('ONCE', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'IRREGULAR_RECURRING');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'TO_REVIEW');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('ENTERTAINMENT', 'SOFTWARE', 'STREAMING', 'MUSIC', 'GAMING', 'FITNESS', 'NEWS', 'CLOUD', 'TELECOM', 'INSURANCE', 'FINANCE', 'EDUCATION', 'PRODUCTIVITY', 'FOOD', 'TRANSPORT', 'SHOPPING', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'BANK_TRANSFER', 'DIRECT_DEBIT', 'PAYPAL', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "DetectionConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "DetectionStatus" AS ENUM ('CONFIRMED', 'MODIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'REACHED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'PLUS', 'PRO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'GRACE_PERIOD', 'ON_HOLD', 'PAUSED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "StorePlatform" AS ENUM ('GOOGLE_PLAY', 'APP_STORE');

-- CreateEnum
CREATE TYPE "ImportSourceType" AS ENUM ('CSV', 'PDF');

-- CreateEnum
CREATE TYPE "CsvRowStatus" AS ENUM ('VALID', 'INVALID', 'DUPLICATE', 'REFUND', 'SKIPPED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "country" TEXT NOT NULL DEFAULT 'US',
    "tier" "UserTier" NOT NULL DEFAULT 'FREE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "merchant_raw" TEXT NOT NULL,
    "merchant_normalized" TEXT NOT NULL,
    "merchant_override" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "frequency" "ExpenseFrequency" NOT NULL DEFAULT 'ONCE',
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
    "payment_method" "PaymentMethod",
    "notes" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL DEFAULT 'IMPORT',
    "import_batch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_import_batches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_type" "ImportSourceType" NOT NULL,
    "filename" TEXT,
    "row_count" INTEGER NOT NULL,
    "imported_count" INTEGER NOT NULL,
    "rejected_count" INTEGER NOT NULL,
    "duplicate_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolled_back_at" TIMESTAMP(3),

    CONSTRAINT "expense_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_detections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expense_id" TEXT NOT NULL,
    "frequency" "ExpenseFrequency" NOT NULL,
    "confidence_score" "DetectionConfidence" NOT NULL,
    "status" "DetectionStatus" NOT NULL,
    "interval_days" INTEGER NOT NULL,
    "amount_variance" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_detections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparison_offers" (
    "id" TEXT NOT NULL,
    "service_name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "verified_price" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "billing_cycle" "BillingCycle" NOT NULL,
    "features_included" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "commitment_duration" INTEGER,
    "direct_official_url" TEXT NOT NULL,
    "last_verified_at" TIMESTAMP(3) NOT NULL,
    "next_check_at" TIMESTAMP(3) NOT NULL,
    "affiliate_note" TEXT,
    "affiliate_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comparison_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_savings_goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "target_amount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "achieved_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_savings_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "store" "StorePlatform",
    "store_product_id" TEXT,
    "store_transaction_id" TEXT,
    "store_original_transaction_id" TEXT,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'EXPIRED',
    "billing_cycle" "BillingCycle",
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "device_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_quotas" (
    "user_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "credits_granted" INTEGER NOT NULL,
    "credits_used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_quotas_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "store_notification_events" (
    "id" TEXT NOT NULL,
    "store" "StorePlatform" NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "users_country_idx" ON "users"("country");

-- CreateIndex
CREATE INDEX "users_tier_idx" ON "users"("tier");

-- CreateIndex
CREATE INDEX "expenses_user_id_date_idx" ON "expenses"("user_id", "date");

-- CreateIndex
CREATE INDEX "expenses_user_id_merchant_normalized_idx" ON "expenses"("user_id", "merchant_normalized");

-- CreateIndex
CREATE INDEX "expenses_user_id_status_idx" ON "expenses"("user_id", "status");

-- CreateIndex
CREATE INDEX "expenses_user_id_frequency_idx" ON "expenses"("user_id", "frequency");

-- CreateIndex
CREATE INDEX "expenses_currency_idx" ON "expenses"("currency");

-- CreateIndex
CREATE INDEX "expenses_import_batch_id_idx" ON "expenses"("import_batch_id");

-- CreateIndex
CREATE INDEX "expense_import_batches_user_id_created_at_idx" ON "expense_import_batches"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "recurring_detections_user_id_status_idx" ON "recurring_detections"("user_id", "status");

-- CreateIndex
CREATE INDEX "recurring_detections_user_id_frequency_idx" ON "recurring_detections"("user_id", "frequency");

-- CreateIndex
CREATE INDEX "recurring_detections_expense_id_idx" ON "recurring_detections"("expense_id");

-- CreateIndex
CREATE INDEX "recurring_detections_user_id_expense_id_idx" ON "recurring_detections"("user_id", "expense_id");

-- CreateIndex
CREATE INDEX "comparison_offers_service_name_country_idx" ON "comparison_offers"("service_name", "country");

-- CreateIndex
CREATE INDEX "comparison_offers_country_billing_cycle_idx" ON "comparison_offers"("country", "billing_cycle");

-- CreateIndex
CREATE INDEX "comparison_offers_next_check_at_idx" ON "comparison_offers"("next_check_at");

-- CreateIndex
CREATE INDEX "comparison_offers_last_verified_at_idx" ON "comparison_offers"("last_verified_at");

-- CreateIndex
CREATE INDEX "user_savings_goals_user_id_status_idx" ON "user_savings_goals"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_user_id_key" ON "subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_store_transaction_id_key" ON "subscriptions"("store_transaction_id");

-- CreateIndex
CREATE INDEX "subscriptions_plan_idx" ON "subscriptions"("plan");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscriptions_store_transaction_id_idx" ON "subscriptions"("store_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "store_notification_events_store_type_idx" ON "store_notification_events"("store", "type");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "expense_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_import_batches" ADD CONSTRAINT "expense_import_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_detections" ADD CONSTRAINT "recurring_detections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_detections" ADD CONSTRAINT "recurring_detections_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_savings_goals" ADD CONSTRAINT "user_savings_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_quotas" ADD CONSTRAINT "ai_quotas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

