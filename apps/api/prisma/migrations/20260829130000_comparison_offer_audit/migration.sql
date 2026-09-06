-- Journal d'administration des offres de comparaison
-- (`specs/comparateur-et-assistant-ia.md` A.8 : qui, quand, avant/apres).
--
-- Aucune cle etrangere vers "users" : la trace doit survivre a la suppression
-- du compte de l'administrateur, donc aucune cascade ne doit pouvoir l'effacer.

-- CreateTable
CREATE TABLE "comparison_offer_audits" (
    "id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_email" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comparison_offer_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comparison_offer_audits_offer_id_created_at_idx" ON "comparison_offer_audits"("offer_id", "created_at");

-- CreateIndex
CREATE INDEX "comparison_offer_audits_actor_user_id_idx" ON "comparison_offer_audits"("actor_user_id");
