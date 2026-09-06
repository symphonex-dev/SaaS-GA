# specs/calculs-financiers.md — Calculs financiers exacts & dashboard

Niveau : algorithme critique. Aucun calcul financier métier ne doit jamais utiliser `number` JavaScript comme représentation de valeur finale.

---

## 1. Représentation canonique de l'argent

Deux représentations coexistent, converties uniquement aux frontières :

- **Persistance (Prisma)** : `Decimal(19, 4)`, conforme à l'exigence stricte du projet (`CLAUDE.md` §5.2).
- **Calcul pur (`packages/shared/finance`)** : unités mineures entières (`bigint`, ex. centimes), pour éliminer tout risque d'erreur de virgule flottante dans l'arithmétique.

```ts
export interface Money {
  amountMinor: bigint;
  currency: "EUR" | "USD" | "GBP" | "CAD" | "AUD";
}

export function toMinorUnits(decimalString: string, currency: string): bigint;
export function fromMinorUnits(amountMinor: bigint, currency: string): string; // pour affichage/persistance
```

Flux : `Prisma Decimal → toMinorUnits → calculs bigint → fromMinorUnits → Decimal/affichage`. Ne jamais arrondir chaque ligne avant de sommer ; l'arrondi n'intervient qu'au dernier stade d'affichage.

```
apps/api/src/lib/finance/
  ├── money.ts
  ├── totals.ts
  ├── averages.ts
  ├── comparisons.ts
  ├── projections.ts
  ├── savings.ts
  └── currency.ts
```

---

## 2. Opérations de base

```ts
export function addMoney(a: Money, b: Money): Money;
export function subtractMoney(a: Money, b: Money): Money;
export function multiplyMoney(value: Money, factor: string): Money;
export function divideMoney(value: Money, divisor: string): Money | null; // null si divisor = 0
```

Si le dénominateur est zéro, retourner explicitement `null` (jamais `0`) lorsque l'absence de donnée doit être distinguée d'une valeur nulle réelle.

---

## 3. Totaux

```ts
totalMonthly = Σ(dépenses ACTIVE du mois) - Σ(remboursements/crédits applicables au mois)
totalAnnual  = Σ(dépenses des 12 mois civils concernés) - Σ(remboursements applicables)
```

- Les dépenses `CANCELLED` sont exclues.
- Un crédit non identifié comme remboursement est exclu du total sauf règle métier explicite.
- Une période est toujours explicite (`{ from: string; to: string }`) — ne jamais utiliser implicitement « les 365 derniers jours » quand une année civile est demandée.

```ts
export interface CategoryTotal {
  category: string;
  amount: Money;
  percentage: string; // calculé en bigint minor units, jamais en number
}
```

`totalSubscriptions` = somme des dépenses appartenant à une récurrence confirmée ou explicitement marquée comme récurrente (jamais les `ONCE` sans détection confirmée).

---

## 4. Moyennes & annualisation

```ts
export const ANNUALIZATION_FACTORS = {
  WEEKLY: 52n,
  MONTHLY: 12n,
  QUARTERLY: 4n,
  YEARLY: 1n,
} as const;
```

Pour `IRREGULAR_RECURRING` :

```ts
// annualized = sum(history) / elapsedDays * 365   — uniquement si historique suffisant
// sinon : annualized = null (jamais une fausse précision)
```

`averageMonthlyCost = coût annuel récurrent / 12`. Coût moyen d'une série : `sum(amounts) / count`, avec `null` si `count = 0`.

---

## 5. Variation période sur période

```ts
export interface PeriodChange {
  current: Money;
  previous: Money;
  absoluteChange: Money;
  percentageChange: string | null; // null si previous = 0 (jamais "Infinity%")
  direction: "UP" | "DOWN" | "UNCHANGED";
}
```

---

## 6. Économies

```ts
export interface Saving {
  id: string;
  sourceExpenseId: string | null;
  sourceOfferId: string | null;
  potentialAmount: Money;
  confirmedAmount: Money;
  status: "POTENTIAL" | "CONFIRMED" | "DISMISSED";
}
```

Une économie **potentielle** (détectée mais non validée par l'utilisateur) ne devient jamais automatiquement **confirmée**. Une économie négative n'est jamais affichée comme une économie :

```ts
function calculatePotentialSavings(currentAnnualMinor: bigint, alternativeAnnualMinor: bigint): bigint {
  return currentAnnualMinor > alternativeAnnualMinor ? currentAnnualMinor - alternativeAnnualMinor : 0n;
}
```

---

## 7. Multi-devises

Devises supportées : `EUR`, `USD`, `GBP`, `CAD`, `AUD`. Le taux de change n'est **jamais inventé**.

```ts
export interface ExchangeRateProvider {
  getRate(from: string, to: string, date: string): Promise<string>; // Decimal string
}
```

Si aucune source de taux n'est intégrée en V1 : soit la conversion est désactivée et le montant s'affiche dans sa devise source avec le code ISO visible, soit un taux manuel documenté est utilisé — jamais un taux arbitraire silencieux. `100 USD + 100 EUR` sans conversion explicite est interdit ; le taux utilisé doit toujours être identifiable et tracé (`sourceCurrency`, `targetCurrency`, `exchangeRate`, `rateDate`).

---

## 8. Dashboard — DTO renvoyés par `apps/api`

```ts
export interface DashboardData {
  kpis: {
    monthlyExpenses: Money;
    activeSubscriptions: number;
    annualRecurringCost: Money;
    expensesToReview: number;
  };
  upcomingExpenses: Array<{ expenseId: string; merchant: string; expectedDate: string; amount: Money; frequency: string }>;
  priceAlerts: Array<{ expenseId: string; merchant: string; previousAmount: Money; currentAmount: Money; increasePercentage: string }>;
  savings: { potential: Money; confirmed: Money; goalTarget: Money | null; goalAchieved: Money | null; goalProgressPercentage: string | null };
  monthlyEvolution: Array<{ month: string; amount: Money }>;
}
```

- « Abonnements actifs » = `status = ACTIVE` ET `frequency != ONCE` ET récurrence confirmée/explicitement définie. Une dépense annulée n'est jamais comptée.
- « Prochaine échéance » = `lastPaymentDate + intervalle estimé`, en préservant autant que possible le jour du mois (`31 janvier → 28/29 février`, jamais une date invalide). Toujours présentée comme une **prévision**, jamais une certitude.
- L'objectif d'épargne affiche une progression bornée `[0, 100]%` même si le calcul interne conserve les valeurs exactes.

**Aucun calcul de KPI ne doit avoir lieu côté `apps/mobile`.** Le mobile reçoit `DashboardData` déjà calculé et se contente de l'afficher.

```
Server → query → moteur financier (bigint) → DashboardData → apps/mobile (affichage seul)
```

---

## 9. Tests unitaires obligatoires

`tests/unit/finance.test.ts` :
- [ ] `0.10 + 0.20 = 0.30` exactement (en unités mineures).
- [ ] Totaux mensuel/annuel/par catégorie/abonnements corrects.
- [ ] Coût moyen correct ; division par zéro → `null`.
- [ ] Annualisation : `×12` mensuel, `×52` hebdo, `×4` trimestriel, `×1` annuel.
- [ ] Remboursements déduits ; dépenses annulées exclues.
- [ ] Variation absolue et en pourcentage exactes ; jamais `Infinity%`.

`tests/unit/multi-currency.test.ts` :
- [ ] Chaque devise supportée testée individuellement (EUR, USD, GBP, CAD, AUD).
- [ ] Taux nul/négatif rejeté ; devise inconnue rejetée.
- [ ] Somme de devises différentes impossible sans conversion explicite.
- [ ] Aucun calcul multi-devises effectué avec `number`.

`tests/unit/dashboard.test.ts` :
- [ ] Chaque KPI correctement calculé sur des fixtures connues (ex. Janvier 100 €, Février 120 € → +20 % ; Mars 90 € → -25 %).
- [ ] Mois sans dépense représenté comme `0`, jamais `null` par erreur d'agrégation.
- [ ] Objectif à `0` ne provoque pas de division par zéro.

---

## 10. Checklist d'acceptation

- [ ] Aucun `number` dans un calcul financier métier (revue de code ciblée obligatoire).
- [ ] Tous les totaux exacts au centime.
- [ ] Économies potentielles et confirmées toujours distinctes.
- [ ] Multi-devises fonctionnel uniquement quand un fournisseur de taux fiable est disponible ; sinon comportement explicite documenté (pas de conversion silencieuse inventée).
- [ ] Aucun KPI recalculé côté mobile.