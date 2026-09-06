# specs/comparateur-et-assistant-ia.md — Comparateur d'offres & assistant IA borné

Niveau : architecture lourde / garde-fous critiques. Deux sous-systèmes regroupés ici car tous deux transforment des données déterministes en contenu présenté à l'utilisateur, avec des garanties fortes d'exactitude et d'absence d'invention.

---

# Partie A — Comparateur d'offres (V1, base restreinte)

## A.1 Positionnement V1

La V1 n'est **pas** un comparateur mondial : une petite base d'offres vérifiées suffit (voir `RECAP_FONCTIONNALITES.md`). Toute offre affichée doit provenir exclusivement de `ComparisonOffer` (voir `specs/schema-donnees.md`) — jamais générée dynamiquement par un LLM.

## A.2 Objectifs

- Reconnaître les abonnements actifs de l'utilisateur (issus des récurrences confirmées).
- Rechercher les offres correspondantes dans `ComparisonOffer`, filtrées par pays et devise.
- Calculer l'économie potentielle sur 12 mois.
- Afficher systématiquement fraîcheur et provenance ; distinguer offres officielles et liens affiliés.
- Ne jamais recommander une offre uniquement parce qu'elle génère une commission.
- Si aucune alternative fiable n'existe : afficher explicitement « Aucune alternative vérifiée disponible » plutôt que de forcer un résultat.

## A.3 Matching déterministe

```ts
interface MatchingContext {
  merchantNormalized: string;
  country: string;
  currency: string;
  now: Date;
}

function matchComparisonOffers(context: MatchingContext, offers: ComparisonOffer[]): ComparisonOffer[] {
  return offers
    .filter((o) => o.country === context.country)
    .filter((o) => normalizeMerchant(o.serviceName) === context.merchantNormalized)
    .filter((o) => o.nextCheckAt >= context.now)
    .sort((a, b) => Number(a.verifiedPriceMinor - b.verifiedPriceMinor));
}
```

Une correspondance approximative peut être proposée comme *suggestion à vérifier*, jamais comme correspondance confirmée sans validation utilisateur. Aucune similarité sémantique non déterministe n'est utilisée pour créer un matching définitif.

## A.4 Calcul des coûts comparés

Tous les calculs utilisent le type `Money` en unités mineures (voir `specs/calculs-financiers.md` §1) :

```
monthlyCost(monthly plan)  = monthly_price
monthlyCost(annual plan)   = annual_price / 12
annualCost(monthly plan)   = monthly_price × 12
annualCost(yearly plan)    = yearly_price
total12MonthCost           = annualCost
potentialSavings           = max(currentAnnual - alternativeAnnual, 0)
```

Une économie négative n'est jamais affichée.

## A.5 Données obligatoires à l'affichage

Pour chaque offre : service, formule actuelle, prix actuel mensuel/annuel, coût actuel sur 12 mois, offre alternative (prix, coût 12 mois, fonctionnalités, limites, engagement), économie potentielle et pourcentage, pays, devise, date de dernière vérification, date de prochaine vérification, lien officiel, lien affilié le cas échéant + mention de commission à proximité immédiate du lien (jamais uniquement dans une page légale).

## A.6 Fraîcheur

```ts
export const COMPARISON_OFFER_MAX_AGE_DAYS = 30;
const isFresh = (Date.now() - offer.lastVerifiedAt.getTime()) <= COMPARISON_OFFER_MAX_AGE_DAYS * 86_400_000;
```

Une offre non fraîche n'est jamais présentée comme « vérifiée », affiche un statut obsolète, est exclue des recommandations automatiques, mais peut rester consultable pour transparence historique.

## A.7 Routes

```
GET  /api/comparisons
GET  /api/comparisons/[expenseId]
GET  /api/comparisons/[expenseId]/offers
POST /api/comparisons/[expenseId]/refresh
```

Le `userId` provient exclusivement de la session — jamais du client.

## A.8 Administration des offres

```
GET    /api/admin/comparison-offers
POST   /api/admin/comparison-offers
PATCH  /api/admin/comparison-offers/[id]
DELETE /api/admin/comparison-offers/[id]
POST   /api/admin/comparison-offers/[id]/verify
```

Le rôle administrateur est déterminé exclusivement côté serveur (jamais un champ `isAdmin` piloté par le client). Toute modification d'offre est auditée (qui, quand, avant/après).

## A.9 Checklist d'acceptation — comparateur

- [ ] Matching respecte commerçant normalisé + pays.
- [ ] Offres obsolètes exclues des recommandations.
- [ ] Coûts actuel/alternatif sur 12 mois exacts au centime.
- [ ] Économie négative jamais affichée.
- [ ] Date de dernière vérification et prochaine vérification toujours affichées.
- [ ] Lien officiel toujours présent ; lien affilié explicitement identifié, classement jamais dépendant de la commission.
- [ ] Endpoints admin inaccessibles à un utilisateur standard.
- [ ] Aucun prix inventé par l'IA à aucun moment du flux.

---

# Partie B — Assistant IA (strictement borné, V1)

## B.1 Principe fondamental

L'IA est une fonction d'assistance facultative. Elle **n'est jamais** la source de vérité :

```
PostgreSQL → Services déterministes → Données autorisées de l'utilisateur → IA → Texte borné
```

L'IA ne modifie jamais directement la base de données.

## B.2 Périmètre V1 — seuls 3 usages sont autorisés

1. **Résumé mensuel** : transformation en texte lisible de chiffres déjà calculés par le moteur financier (total, variation, catégories principales, nouveaux abonnements, hausses, économies).
2. **Explication simple d'une hausse** : le backend calcule d'abord `currentMonthTotal`, `previousMonthTotal`, `difference`, `percentageDifference`, `newRecurringExpenses`, `priceIncreases`, `cancelledExpenses` ; l'IA ne reçoit que ces faits déjà calculés et les met en phrase.
3. **Une recommandation basée sur les chiffres calculés** (ex. une piste d'économie déjà identifiée par le comparateur ou par une hausse de prix détectée) — jamais un plan financier, jamais un conseil personnalisé complexe.

**Explicitement hors périmètre V1** (à ne jamais implémenter, même partiellement) : chatbot financier ouvert, conversation illimitée, analyse de questions personnelles libres, prédictions financières, conseils personnalisés complexes, catégorisation de dépense entièrement pilotée par l'IA (la catégorie reste choisie par l'utilisateur ou par des règles déterministes, jamais imposée par un LLM), génération de plans financiers, traduction via IA (les traductions de l'app sont statiques, fichiers `en`/`fr`/`es`, jamais générées à la volée), conseils d'investissement, conseils de crédit, évaluation de solvabilité, garantie de résultat financier, toute action destructive ou de mutation (résiliation, suppression de compte/transaction, action de paiement).

## B.3 Architecture

```
apps/api/src/server/ai/
  ├── ai.service.ts
  ├── ai.provider.ts
  ├── ai.schemas.ts
  ├── ai.quota.ts
  ├── ai.prompt.ts
  ├── ai.context.ts
  ├── ai.guardrails.ts
  ├── ai.redaction.ts
  └── providers/
      ├── openai.provider.ts   (ou provider équivalent configuré)
      └── mock.provider.ts
```

```ts
export interface AiProvider {
  generate(input: AiGenerationInput): Promise<AiGenerationResult>;
}
```

Le provider est injecté par configuration serveur, jamais codé en dur. Un provider `mock` doit exister pour les tests (le système doit rester fonctionnel si l'IA est indisponible — les 3 usages ne sont qu'un enrichissement, jamais un prérequis fonctionnel).

## B.4 Clé API

```
AI_PROVIDER=
AI_MODEL=
AI_API_KEY=
AI_MAX_OUTPUT_TOKENS=
AI_MONTHLY_CREDITS_FREE=
AI_MONTHLY_CREDITS_PLUS=
```

Interdiction absolue de `NEXT_PUBLIC_AI_API_KEY` ou de toute exposition de la clé au bundle mobile. La clé ne vit que côté `apps/api`.

## B.5 Contexte transmis (RAG local minimal)

```ts
export interface AiContext {
  locale: "en" | "fr" | "es";
  currency: string;
  month: string;
  monthlyTotal: string;
  previousMonthlyTotal: string;
  topCategories: Array<{ category: string; amount: string }>;
  newRecurringExpenses: Array<{ merchant: string; amount: string }>;
  priceIncreases: Array<{ merchant: string; previousAmount: string; currentAmount: string }>;
  cancelledExpenses: Array<{ merchant: string }>;
}
```

Uniquement des faits déjà calculés — jamais de données brutes non nécessaires. Ne jamais envoyer : hash de mot de passe, token de session, token de reset, secrets, identifiants de transaction des stores, données d'autres utilisateurs, informations administratives.

## B.6 Prompt système (versionné, serveur uniquement)

```ts
export const AI_SYSTEM_PROMPT_VERSION = "v1-bounded";

export const AI_SYSTEM_PROMPT = `
You are a bounded financial-summary assistant for a subscription-tracking app.

You may only reason over the facts explicitly supplied in the context.
Never invent transactions, merchants, prices, subscriptions, dates,
categories, or savings figures.

You may only perform exactly one of these three tasks per call:
1. Summarize the supplied monthly figures in plain language.
2. Explain a supplied spending increase using only the supplied facts.
3. State one recommendation derived strictly from a supplied figure
   (a detected price increase or a comparator saving already computed
   by the application).

Never provide investment advice, credit advice, solvency assessments,
or guarantees of financial outcomes.
Never suggest or perform: subscription cancellation, account deletion,
transaction deletion, database mutation, or payment action.
Never classify or recategorize a merchant or expense.
Never translate; respond only in the language explicitly requested.

Clearly state uncertainty whenever the provided data is insufficient.
All financial amounts are supplied facts; never recalculate them.
`;
```

## B.7 Validation de sortie

```ts
export const aiResponseSchema = z.object({
  answer: z.string().min(1).max(1200),
  uncertainty: z.enum(["NONE", "LOW", "MEDIUM", "HIGH"]),
  referencedExpenseIds: z.array(z.string()).max(20),
});
```

Toute sortie invalide est rejetée, journalisée, et remplacée par une réponse générique sûre — jamais affichée telle quelle à l'utilisateur.

## B.8 Quotas & rate limiting

```ts
if (quota.creditsUsed >= quota.creditsGranted) throw new AiQuotaExceededError();
```

Incrémentation atomique (requête SQL conditionnelle) pour éviter qu'un appel concurrent ne dépasse le quota :

```sql
UPDATE ai_quotas
SET credits_used = credits_used + 1
WHERE user_id = $1 AND period_start = $2 AND credits_used < credits_granted;
```

Rate limit dédié : `ai:user:{userId}`, plus strict que les endpoints ordinaires.

## B.9 Tests obligatoires

- [ ] Le provider IA est interchangeable (mock utilisé en test).
- [ ] Le contexte envoyé ne contient jamais de champ interdit (test de sérialisation du contexte).
- [ ] Aucun contexte d'un autre utilisateur n'est jamais transmis.
- [ ] Une sortie hors schéma est rejetée et journalisée, jamais affichée.
- [ ] Le quota ne peut pas être dépassé même avec des appels concurrents (test de concurrence).
- [ ] Le système fonctionne intégralement sans IA disponible (dashboard, comparateur, import, récurrences).
- [ ] Aucun des usages hors-périmètre (§B.2) n'est accessible via une route ou un composant.

## B.10 Checklist d'acceptation — IA

- [ ] Seuls les 3 usages autorisés existent dans le code.
- [ ] Clé API jamais exposée côté mobile.
- [ ] Sorties toujours validées par Zod avant affichage.
- [ ] Quotas appliqués et non contournables par des appels concurrents.
- [ ] Traductions statiques uniquement, jamais via IA.