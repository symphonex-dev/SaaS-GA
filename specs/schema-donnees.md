# specs/schema-donnees.md — Schéma de données PostgreSQL / Prisma

Niveau : intégration standard (CRUD / schéma). Ce fichier est la référence unique du schéma ; ne pas dupliquer les définitions de modèles ailleurs. Toutes les autres specs y renvoient.

---

## 1. Générateur & datasource

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_DATABASE_URL")
}
```

Emplacement : `apps/api/prisma/schema.prisma`.

---

## 2. Enums

```prisma
enum UserTier {
  FREE
  PLUS
}

enum ExpenseFrequency {
  ONCE
  WEEKLY
  MONTHLY
  QUARTERLY
  YEARLY
  IRREGULAR_RECURRING
}

enum ExpenseStatus {
  ACTIVE
  CANCELLED
  TO_REVIEW
}

enum ExpenseCategory {
  ENTERTAINMENT
  SOFTWARE
  STREAMING
  MUSIC
  GAMING
  FITNESS
  NEWS
  CLOUD
  TELECOM
  INSURANCE
  FINANCE
  EDUCATION
  PRODUCTIVITY
  FOOD
  TRANSPORT
  SHOPPING
  OTHER
}

enum PaymentMethod {
  CARD
  BANK_TRANSFER
  DIRECT_DEBIT
  PAYPAL
  CASH
  OTHER
}

enum DetectionConfidence {
  HIGH
  MEDIUM
  LOW
}

enum DetectionStatus {
  CONFIRMED
  MODIFIED
  REJECTED
}

enum GoalStatus {
  ACTIVE
  REACHED
  ABANDONED
}

// Note V1 : seul FREE et PLUS sont commercialisés. PRO existe dans l'enum
// pour éviter une migration future coûteuse, mais aucun flux V1 (checkout,
// entitlements) ne doit produire ni consommer la valeur PRO.
enum SubscriptionPlan {
  FREE
  PLUS
  PRO
}

enum SubscriptionStatus {
  ACTIVE
  TRIALING
  GRACE_PERIOD
  ON_HOLD
  PAUSED
  CANCELED
  EXPIRED
}

enum BillingCycle {
  MONTHLY
  YEARLY
}

enum StorePlatform {
  GOOGLE_PLAY
  APP_STORE
}

enum ImportSourceType {
  CSV
  PDF
}

enum CsvRowStatus {
  VALID
  INVALID
  DUPLICATE
  REFUND
  SKIPPED
}
```

---

## 3. `User`

```prisma
model User {
  id           String    @id @default(cuid())
  email        String    @unique
  passwordHash String    @map("password_hash")

  language     String    @default("en")
  currency     String    @default("EUR")
  country      String    @default("US")

  tier         UserTier  @default(FREE)

  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")
  deletedAt    DateTime? @map("deleted_at")

  expenses            Expense[]
  recurringDetections  RecurringDetection[]
  savingsGoals         UserSavingsGoal[]
  subscription         Subscription?
  passwordResetTokens  PasswordResetToken[]
  authSessions         AuthSession[]
  importBatches        ExpenseImportBatch[]
  aiQuota              AiQuota?

  @@index([deletedAt])
  @@index([country])
  @@index([tier])
  @@map("users")
}
```

Règles :
- `email` unique, normalisé en minuscules avant stockage.
- `passwordHash` n'est jamais retourné dans une réponse API.
- Validation d'inscription : toute adresse e-mail valide au sens RFC est acceptée (voir `specs/auth-comptes-rgpd.md` §2 pour la liste de fournisseurs à couvrir par les tests). Aucune liste blanche de domaines dans le schéma ou la validation Zod.
- `tier` n'est jamais modifié par un champ client arbitraire — dérivé exclusivement de `Subscription.plan` via le service d'entitlements.
- Défaut `country = "US"` puisque la langue par défaut est `en` ; le pays réel est choisi explicitement lors de l'onboarding (jamais déduit de la langue).

---

## 4. `Expense`

```prisma
model Expense {
  id                 String           @id @default(cuid())
  userId             String           @map("user_id")

  merchantRaw        String           @map("merchant_raw")
  merchantNormalized String           @map("merchant_normalized")
  merchantOverride    String?         @map("merchant_override")

  amount             Decimal          @db.Decimal(19, 4)
  currency           String

  date               DateTime

  frequency          ExpenseFrequency @default(ONCE)
  category           ExpenseCategory  @default(OTHER)

  paymentMethod      PaymentMethod?   @map("payment_method")
  notes              String?

  status             ExpenseStatus    @default(ACTIVE)

  source             String           @default("IMPORT") @map("source")
  importBatchId      String?          @map("import_batch_id")

  createdAt          DateTime         @default(now()) @map("created_at")

  user               User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  importBatch        ExpenseImportBatch? @relation(fields: [importBatchId], references: [id], onDelete: SetNull)
  recurringDetections RecurringDetection[]

  @@index([userId, date])
  @@index([userId, merchantNormalized])
  @@index([userId, status])
  @@index([userId, frequency])
  @@index([currency])
  @@index([importBatchId])
  @@map("expenses")
}
```

Règles :
- `source` vaut `"IMPORT"` (issu d'un CSV/PDF) ou `"MANUAL"` (correction, ajout d'espèces, ajout d'une transaction absente du relevé — jamais un parcours principal, voir `specs/import-releves.md` §9 et `specs/ui-composants-mobile.md`).
- `merchantRaw` conserve la valeur brute d'origine, jamais remplacée.
- `merchantOverride` est la correction manuelle explicite de l'utilisateur ; toujours prioritaire sur `merchantNormalized` à l'affichage (voir résolution dans `specs/import-releves.md`).
- `amount` strictement positif ; `currency` ∈ devises supportées ; toute requête `Expense` doit filtrer par `userId`.

---

## 5. `ExpenseImportBatch`

```prisma
model ExpenseImportBatch {
  id             String            @id @default(cuid())
  userId         String            @map("user_id")

  sourceType     ImportSourceType  @map("source_type")
  filename       String?
  rowCount       Int               @map("row_count")
  importedCount  Int               @map("imported_count")
  rejectedCount  Int               @map("rejected_count")
  duplicateCount Int               @map("duplicate_count")

  createdAt      DateTime          @default(now()) @map("created_at")
  rolledBackAt   DateTime?         @map("rolled_back_at")

  user           User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  expenses       Expense[]

  @@index([userId, createdAt])
  @@map("expense_import_batches")
}
```

Permet le rollback contrôlé d'un import complet (CSV ou PDF). Voir `specs/import-releves.md`.

---

## 6. `RecurringDetection`

```prisma
model RecurringDetection {
  id              String              @id @default(cuid())
  userId          String              @map("user_id")
  expenseId       String              @map("expense_id")

  frequency       ExpenseFrequency

  confidenceScore DetectionConfidence @map("confidence_score")
  status          DetectionStatus

  intervalDays    Int                 @map("interval_days")
  amountVariance  Decimal             @db.Decimal(19, 4) @map("amount_variance")

  createdAt       DateTime            @default(now()) @map("created_at")
  updatedAt       DateTime            @updatedAt @map("updated_at")

  user            User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  expense         Expense             @relation(fields: [expenseId], references: [id], onDelete: Cascade)

  @@index([userId, status])
  @@index([userId, frequency])
  @@index([expenseId])
  @@index([userId, expenseId])
  @@map("recurring_detections")
}
```

Une détection n'est jamais créée en dehors du moteur déterministe de `specs/moteur-recurrence.md`.

---

## 7. `ComparisonOffer`

```prisma
model ComparisonOffer {
  id                 String       @id @default(cuid())

  serviceName        String       @map("service_name")
  country            String

  verifiedPrice      Decimal      @db.Decimal(19, 4) @map("verified_price")
  currency           String

  billingCycle       BillingCycle @map("billing_cycle")

  featuresIncluded   Json         @map("features_included")
  limits             Json

  commitmentDuration Int?         @map("commitment_duration")

  directOfficialUrl  String       @map("direct_official_url")

  lastVerifiedAt     DateTime     @map("last_verified_at")
  nextCheckAt        DateTime     @map("next_check_at")

  affiliateNote      String?      @map("affiliate_note")
  affiliateUrl       String?      @map("affiliate_url")

  createdAt          DateTime     @default(now()) @map("created_at")
  updatedAt          DateTime     @updatedAt @map("updated_at")

  @@index([serviceName, country])
  @@index([country, billingCycle])
  @@index([nextCheckAt])
  @@index([lastVerifiedAt])
  @@map("comparison_offers")
}
```

Voir garde-fous complets dans `specs/comparateur-et-assistant-ia.md`. Rappel V1 : base restreinte, jamais de prix inventé, jamais d'offre obsolète présentée comme vérifiée.

---

## 8. `UserSavingsGoal`

```prisma
model UserSavingsGoal {
  id             String     @id @default(cuid())
  userId         String     @map("user_id")

  targetAmount   Decimal    @db.Decimal(19, 4) @map("target_amount")
  currency       String

  achievedAmount Decimal    @db.Decimal(19, 4) @default(0) @map("achieved_amount")

  status         GoalStatus @default(ACTIVE)

  createdAt      DateTime   @default(now()) @map("created_at")
  updatedAt      DateTime   @updatedAt @map("updated_at")

  user           User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, status])
  @@map("user_savings_goals")
}
```

Contraintes applicatives : `targetAmount > 0`, `0 <= achievedAmount <= targetAmount` ; passage automatique à `REACHED` quand `achievedAmount >= targetAmount`.

---

## 9. `Subscription` (in-app purchase, pas de Stripe)

```prisma
model Subscription {
  id                        String              @id @default(cuid())
  userId                    String              @unique @map("user_id")

  store                     StorePlatform?
  storeProductId            String?             @map("store_product_id")
  storeTransactionId        String?             @unique @map("store_transaction_id")
  storeOriginalTransactionId String?             @map("store_original_transaction_id")

  plan                      SubscriptionPlan    @default(FREE)
  status                    SubscriptionStatus  @default(EXPIRED)
  billingCycle              BillingCycle?       @map("billing_cycle")

  currentPeriodEnd          DateTime?           @map("current_period_end")
  cancelAtPeriodEnd         Boolean             @default(false) @map("cancel_at_period_end")
  canceledAt                DateTime?           @map("canceled_at")

  createdAt                 DateTime            @default(now()) @map("created_at")
  updatedAt                 DateTime            @updatedAt @map("updated_at")

  user                      User                @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([plan])
  @@index([status])
  @@index([storeTransactionId])
  @@map("subscriptions")
}
```

Différences volontaires par rapport à un modèle Stripe classique :
- Aucun `stripeCustomerId` / `stripeSubscriptionId`.
- `store` + `storeProductId` + identifiants de transaction du store remplacent les identifiants Stripe.
- `cancelAtPeriodEnd` reproduit la sémantique Stripe standard : passe à `true` dès que l'utilisateur résilie (notification `SUBSCRIPTION_CANCELED` / `autoRenewStatus:false`), **sans** modifier `plan` ni `status` — l'accès payant reste actif jusqu'à `currentPeriodEnd` (voir `specs/paiement-in-app.md` §6, décision produit définitive). `plan` ne repasse à `FREE` qu'à l'expiration effective de la période. `canceledAt` trace la date de la décision de résiliation à des fins d'historique/support, indépendamment de la date de fin d'accès réelle.

---

## 10. `AuthSession` (token de session mobile — pas de cookie)

```prisma
model AuthSession {
  id           String    @id @default(cuid())
  userId       String    @map("user_id")

  tokenHash    String    @unique @map("token_hash")

  deviceLabel  String?   @map("device_label")

  createdAt    DateTime  @default(now()) @map("created_at")
  lastUsedAt   DateTime  @default(now()) @map("last_used_at")
  expiresAt    DateTime  @map("expires_at")
  revokedAt    DateTime? @map("revoked_at")

  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
  @@map("auth_sessions")
}
```

Jamais de token brut stocké (même schéma de génération/hash que `PasswordResetToken` — voir `specs/auth-comptes-rgpd.md` §4). `revokedAt` est renseigné à la déconnexion (`POST /api/auth/logout`) et lors d'une suppression de compte (§13, `account.service.ts`). `deviceLabel` est facultatif, informatif uniquement (ex. « Android — Pixel 8 »), jamais utilisé comme critère d'autorisation.

---

## 11. `PasswordResetToken`

```prisma
model PasswordResetToken {
  id        String    @id @default(cuid())
  userId    String    @map("user_id")

  tokenHash String    @unique @map("token_hash")

  expiresAt DateTime  @map("expires_at")
  usedAt    DateTime? @map("used_at")

  createdAt DateTime  @default(now()) @map("created_at")

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
  @@map("password_reset_tokens")
}
```

Jamais de token brut stocké ; voir `specs/auth-comptes-rgpd.md`.

---

## 12. `AiQuota`

```prisma
model AiQuota {
  userId         String   @id @map("user_id")
  periodStart    DateTime @map("period_start")
  creditsGranted Int      @map("credits_granted")
  creditsUsed    Int      @default(0) @map("credits_used")

  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("ai_quotas")
}
```

Un seul enregistrement par utilisateur et par période. Voir garde-fous dans `specs/comparateur-et-assistant-ia.md`.

---

## 13. `StoreNotificationEvent` (idempotence des notifications serveur des stores)

```prisma
model StoreNotificationEvent {
  id          String    @id
  store       StorePlatform
  type        String
  processedAt DateTime?
  createdAt   DateTime  @default(now())

  @@index([store, type])
  @@map("store_notification_events")
}
```

Remplace la table d'idempotence webhook Stripe du document de base : même principe (enregistrer l'ID avant traitement, ne jamais retraiter un ID déjà présent), appliqué aux notifications Google Real-Time Developer Notifications et Apple App Store Server Notifications V2.

---

## 14. Migrations & seed

```bash
npx prisma migrate dev --schema=apps/api/prisma/schema.prisma
npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
npx prisma generate --schema=apps/api/prisma/schema.prisma
npx prisma db seed
```

`apps/api/prisma/seed.ts` :
- Crée uniquement des `ComparisonOffer` de démonstration (aucune donnée personnelle, aucun mot de passe, aucun token, aucune clé API réelle).
- N'insère jamais de `User` avec un mot de passe en clair.

`package.json` (workspace `apps/api`) :

```json
{
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

---

## 15. Checklist de validation

- [ ] Les 9 modèles métier (`User`, `Expense`, `ExpenseImportBatch`, `RecurringDetection`, `ComparisonOffer`, `UserSavingsGoal`, `Subscription`, `AuthSession`, `PasswordResetToken`) + 2 tables techniques (`StoreNotificationEvent`, `AiQuota`) sont créés.
- [ ] `AuthSession` : token brut jamais stocké (uniquement `tokenHash`) ; `revokedAt` correctement renseigné à la déconnexion et à la suppression de compte.
- [ ] Toutes les clés étrangères utilisent `onDelete: Cascade` sauf `Expense.importBatch` (`SetNull`, un import supprimé ne doit pas supprimer les dépenses déjà confirmées hors rollback explicite).
- [ ] Tous les index utilisateur (`userId`, ou `userId` + champ de filtre) sont présents.
- [ ] Aucun champ Stripe (`stripeCustomerId`, etc.) n'existe dans le schéma.
- [ ] `SubscriptionPlan.PRO` n'est utilisé par aucun service V1.
- [ ] Migrations versionnées et reproductibles (`prisma migrate deploy` sur base vierge fonctionne).
- [ ] Seed reproductible, sans donnée sensible.