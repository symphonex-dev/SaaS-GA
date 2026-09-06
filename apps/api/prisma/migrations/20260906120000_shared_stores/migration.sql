-- Magasins partages entre instances (CLAUDE.md §10.11).
--
-- Deux tables techniques, ajoutees hors de la liste fermee de
-- `specs/schema-donnees.md` §15, parce qu'aucun modele existant ne peut porter
-- un etat qui doit etre commun a tous les process :
--
--  - "rate_limit_counters" : sans compteur partage, N instances autorisent N
--    fois la limite annoncee (`specs/auth-comptes-rgpd.md` §10) ;
--  - "import_previews" : la confirmation d'un import doit revalider a partir de
--    donnees serveur (`specs/import-releves.md` §2), or le fichier source est
--    supprime des la fin de l'apercu (§3). En memoire de process, la
--    confirmation echoue des qu'elle atteint une autre instance.

-- CreateTable
CREATE TABLE "rate_limit_counters" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limit_counters_expires_at_idx" ON "rate_limit_counters"("expires_at");

-- CreateTable
CREATE TABLE "import_previews" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "import_previews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_previews_user_id_idx" ON "import_previews"("user_id");

-- CreateIndex
CREATE INDEX "import_previews_expires_at_idx" ON "import_previews"("expires_at");

-- AddForeignKey
ALTER TABLE "import_previews" ADD CONSTRAINT "import_previews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
