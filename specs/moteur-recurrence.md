# specs/moteur-recurrence.md — Moteur déterministe de détection des récurrences

Niveau : algorithme critique. Ce moteur est **100 % déterministe : sans IA, sans LLM, sans appel réseau**. Même entrée + mêmes règles ⇒ même résultat, à chaque exécution.

---

## 1. Emplacement

```
apps/api/src/server/services/recurring-detection.service.ts
apps/api/src/lib/recurring/
  ├── interval.ts
  ├── amount.ts
  ├── frequency.ts
  ├── confidence.ts
  └── normalize.ts
```

---

## 2. Données analysées

`merchantNormalized` (ou `merchantOverride` si défini), `date`, `amount`, `currency`, historique des transactions du même groupe de commerçant pour l'utilisateur.

- Les transactions `CANCELLED` n'alimentent pas une nouvelle détection active.
- Les remboursements identifiés (voir `specs/import-releves.md` §6) sont exclus de l'historique des paiements récurrents.

---

## 3. Préconditions

- Minimum **3 occurrences** pour une détection standard. Une seule transaction n'est jamais considérée comme récurrente.
- Exception documentée : `YEARLY` peut nécessiter moins d'observations uniquement si un mécanisme spécifique est explicitement implémenté et testé — non activé par défaut.

---

## 4. Calcul des intervalles

Pour des dates triées `d1..dn` : `interval_i = d_i - d_(i-1)` en jours calendaires.

```ts
export const RECURRENCE_WINDOWS = {
  WEEKLY:    { targetDays: 7,   toleranceDays: 2 },
  MONTHLY:   { targetDays: 30,  toleranceDays: 5 },
  QUARTERLY: { targetDays: 91,  toleranceDays: 10 },
  YEARLY:    { targetDays: 365, toleranceDays: 20 },
} as const;
```

Ces valeurs sont centralisées **une seule fois** — jamais dupliquées ailleurs.

- **MONTHLY** : la majorité des intervalles ∈ [25, 35] jours.
- **WEEKLY** : la majorité des intervalles ∈ [5, 9] jours.
- **QUARTERLY** : la majorité des intervalles ∈ [81, 101] jours.
- **YEARLY** : la majorité des intervalles ∈ [345, 385] jours (tenir compte des années bissextiles).
- **IRREGULAR_RECURRING** : intervalles non uniformes mais répétition statistique déterministe sur une période suffisamment longue et un nombre d'occurrences suffisant. Classification conservatrice par construction.

---

## 5. Variation des montants & hausses de prix

```ts
// amountVariance = max(amounts) - min(amounts)      (Decimal exact)
// relativeVariance = (max - min) / average          (Decimal exact)
```

Une hausse de prix n'est confirmée que si elle est observée sur **au moins deux occurrences consécutives** après le changement (une variation ponctuelle qui revient à l'ancien montant n'est pas une hausse durable).

```ts
export interface PriceChange {
  previousAmount: string;
  currentAmount: string;
  absoluteChange: string;
  percentageChange: string;
  detectedAt: string;
  confirmed: boolean;
}
```

Exemple confirmé : `9.99, 9.99, 11.99, 11.99`. Exemple non confirmé (variation ponctuelle) : `9.99, 12.99, 9.99`.

---

## 6. Score de confiance

```ts
export type DetectionConfidence = "HIGH" | "MEDIUM" | "LOW";
```

Grille déterministe, centralisée dans un seul fichier (`confidence.ts`) :

| Critère | Points |
|---|---|
| Commerçant stable | +30 |
| Intervalle périodique | +25 |
| Au moins 5 occurrences | +20 |
| Faible variation de montant | +15 |
| Historique ≥ 90 jours | +10 |

Total max 100. `HIGH ≥ 80`, `MEDIUM ≥ 60`, `LOW < 60`.

---

## 7. Interface pure

```ts
export interface RecurringDetectionInput {
  merchantNormalized: string;
  currency: string;
  transactions: Array<{ id: string; date: string; amount: string }>;
}

export interface RecurringDetectionResult {
  isRecurring: boolean;
  frequency: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "IRREGULAR_RECURRING" | null;
  confidence: DetectionConfidence | null;
  confidenceScore: number;
  intervalDays: number | null;
  amountVariance: string;
  occurrences: number;
  priceChange: PriceChange | null;
}

export function detectRecurrence(input: RecurringDetectionInput): RecurringDetectionResult;
```

`detectRecurrence` est une **fonction pure** : aucun accès réseau, aucun accès base de données, aucune dépendance à `Date.now()` ou `Math.random()`. Toute date de référence nécessaire est passée explicitement en paramètre par l'appelant.

---

## 8. Validation utilisateur

```
POST  /api/recurring/:id/confirm
PATCH /api/recurring/:id
POST  /api/recurring/:id/reject
```

```ts
export const modifyRecurringDetectionSchema = z.object({
  frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "IRREGULAR_RECURRING"]),
});
```

`CONFIRM` → `status = CONFIRMED` ; `MODIFY` → `status = MODIFIED` ; `REJECT` → `status = REJECTED`. L'utilisateur peut toujours rejeter une proposition — aucune détection n'est appliquée sans validation possible.

---

## 9. Invariants (à ne jamais violer)

- [ ] Une détection appartient à un seul utilisateur ; jamais consultable par un autre.
- [ ] Aucune transaction d'un autre utilisateur n'entre dans l'analyse.
- [ ] Les remboursements ne comptent jamais comme paiements récurrents.
- [ ] Les transactions `CANCELLED` ne déclenchent pas de nouvelle récurrence active.
- [ ] Le moteur ne dépend jamais de l'IA.
- [ ] Le résultat est strictement reproductible.
- [ ] Tous les montants utilisent des décimales exactes (jamais `number` flottant).
- [ ] L'utilisateur peut toujours rejeter une proposition.

---

## 10. Tests unitaires obligatoires

`tests/unit/recurring-detection.test.ts` :
- [ ] 3 paiements mensuels réguliers → `MONTHLY`.
- [ ] 4 paiements hebdomadaires → `WEEKLY`.
- [ ] Paiements trimestriels → `QUARTERLY`.
- [ ] Paiements annuels → `YEARLY` (année bissextile gérée).
- [ ] Historique irrégulier mais suffisamment récurrent → `IRREGULAR_RECURRING`.
- [ ] Une seule transaction → non récurrent.
- [ ] Deux transactions → insuffisant pour une détection standard.
- [ ] Commerçants différents jamais regroupés.
- [ ] Remboursement exclu ; transaction annulée exclue.
- [ ] Montant stable augmente la confiance ; forte variation la réduit.
- [ ] Score `HIGH`/`MEDIUM`/`LOW` correctement calculé sur des fixtures fixes.
- [ ] Même entrée exécutée plusieurs fois → résultat strictement identique.

`tests/unit/price-change.test.ts` :
- [ ] `9.99 → 9.99` = aucune hausse.
- [ ] `9.99 → 11.99` (2 occurrences) = hausse confirmée.
- [ ] `9.99 → 12.99 → 9.99` = variation non durable.
- [ ] Aucune division par zéro ; variation absolue et pourcentage exactes.

---

## 11. Checklist d'acceptation

- [ ] Algorithme entièrement déterministe, aucune IA.
- [ ] Hebdomadaire, mensuel, trimestriel, annuel, irrégulier récurrent tous supportés.
- [ ] Score de confiance calculé selon une grille unique et centralisée.
- [ ] Hausses de prix détectées uniquement si confirmées sur plusieurs occurrences.
- [ ] Confirmation / modification / rejet utilisateur disponibles et respectés.