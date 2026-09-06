# specs/import-releves.md — Import de relevés (CSV & PDF), parsing, doublons, rollback

Niveau : architecture lourde / algorithmes critiques. Ce fichier ne doit jamais être mélangé avec les flux CRUD standards. C'est le **parcours principal** de création de dépenses de l'application (voir `CLAUDE.md` §1 et §5.4).

---

## 1. Positionnement produit

- L'import (CSV en priorité, PDF en second) est le moyen normal d'alimenter les dépenses.
- La saisie manuelle (`Expense.source = "MANUAL"`) reste disponible uniquement pour : corriger une transaction importée, ajouter une dépense en espèces, ajouter une transaction absente d'un relevé. Elle n'a pas d'écran dédié mis en avant dans la navigation principale ; elle est accessible depuis un menu secondaire ("Ajouter une transaction manquante").
- Le fichier source (CSV ou PDF) est **toujours** supprimé du stockage temporaire immédiatement après traitement — jamais conservé durablement.

---

## 2. Architecture du pipeline

```
apps/api/src/server/services/import.service.ts
apps/api/src/lib/csv/
  ├── encoding.ts
  ├── delimiter.ts
  ├── parser.ts
  ├── date.ts
  ├── amount.ts
  ├── duplicate.ts
  └── mapping.ts
apps/api/src/lib/pdf/
  ├── extract.ts
  ├── line-classifier.ts
  └── confidence.ts
```

Pipeline commun (CSV et PDF convergent vers la même étape de preview/validation) :

```
Upload (multipart, depuis apps/mobile)
 ↓
Contrôles fichier (taille, MIME, extension, contenu)
 ↓
[CSV] Détection encodage → Détection séparateur → Parsing → Mapping colonnes
[PDF] Extraction de texte → Classification des lignes → Score de confiance par ligne
 ↓
Normalisation des cellules / lignes
 ↓
Validation (Zod)
 ↓
Détection débit/crédit, détection des remboursements
 ↓
Détection des doublons
 ↓
Preview (renvoyé à apps/mobile, jamais de calcul métier côté mobile)
 ↓
Confirmation utilisateur (mapping ajustable, lignes incertaines à traiter)
 ↓
Insertion transactionnelle (ExpenseImportBatch + Expense[])
 ↓
Suppression immédiate du fichier source (bloc finally)
```

Le serveur **revalide toujours** au moment de la confirmation — le preview client n'est jamais une source de vérité.

---

## 2 bis. Conservation de l'aperçu entre `preview` et `confirm`

Le fichier source est supprimé dès la fin de l'aperçu (§3), et la confirmation doit revalider à partir de données **serveur** (§2). L'aperçu analysé est donc conservé dans la table `import_previews` (`IMPORT_PREVIEW_STORE=postgres`, obligatoire en production), avec trois garanties :

- **TTL** : `IMPORT_PREVIEW_TTL_MINUTES`. Passé ce délai, la confirmation est refusée (`IMPORT_PREVIEW_EXPIRED`) et les lignes sont purgées — aucune donnée de relevé ne subsiste au-delà.
- **Propriété** : chaque accès filtre par `userId`. L'aperçu d'un autre compte est traité comme inexistant, jamais « trouvé puis refusé ».
- **Consommation unique** : l'aperçu est **réservé avant** toute écriture, par un `UPDATE … WHERE consumed_at IS NULL` atomique. Deux confirmations concurrentes du même import ne peuvent donc pas créer deux lots ; seule la gagnante poursuit.

En mémoire de process (`memory`, développement uniquement), la confirmation échouerait dès qu'elle atteindrait une autre instance, et tout redémarrage perdrait les aperçus en cours.

---

## 3. Limites & contrôle fichier

```ts
const maxFileSize = env.MAX_IMPORT_FILE_SIZE_BYTES; // défaut 10 MiB
const maxCsvRows = env.MAX_CSV_ROWS;                // défaut 10000
const maxPdfPages = env.MAX_PDF_PAGES;               // défaut 30
```

- Types MIME acceptés (indicatifs, jamais suffisants seuls) : `text/csv`, `application/csv`, `application/vnd.ms-excel`, `text/plain` pour CSV ; `application/pdf` pour PDF.
- Le serveur revérifie systématiquement : extension, contenu réel (signature de fichier), taille, structure, nombre de lignes/pages, capacité de parsing. Rejet explicite de `.exe`, `.zip`, `.jpg`, `.png`, même renommés en `.csv`/`.pdf`.
- Le fichier est stocké dans un répertoire temporaire isolé le temps du traitement, puis supprimé (`fs.rm(path, { force: true })` dans un bloc `finally`, y compris en cas d'erreur).

---

## 4. Pipeline CSV

### 4.1 Encodage
Support `UTF-8` (avec/sans BOM) et `ISO-8859-1` en repli. Les caractères accentués (« Électricité », « Crédit Agricole ») doivent être préservés.

### 4.2 Détection du séparateur
Séparateurs supportés : `,` `;` `\t`. Algorithme : échantillonner un nombre représentatif de lignes, compter les séparateurs candidats **hors champs quotés**, retenir celui produisant un nombre de colonnes cohérent sur l'échantillon ; en cas d'ambiguïté, demander confirmation à l'utilisateur plutôt que de deviner.

### 4.3 Parsing
Le parser doit gérer les champs quotés, guillemets échappés, champs vides, retours à la ligne dans un champ quoté, séparateurs différents. **Ne jamais** utiliser `line.split(",")`.

### 4.4 Mapping des colonnes

```ts
export interface CsvColumnMapping {
  dateColumn: number;
  amountColumn: number;
  descriptionColumn: number;
  debitColumn?: number;
  creditColumn?: number;
  currencyColumn?: number;
}
```

Mapping automatique proposé par heuristiques explicites uniquement (ex. en-têtes contenant `date`/`transaction date` ; `amount`/`montant`/`value` ; `debit`/`débit`/`withdrawal` ; `credit`/`crédit`/`deposit`). Toujours modifiable par l'utilisateur avant import définitif.

### 4.5 Montants

```ts
export interface ParsedMoney { value: string; sign: "positive" | "negative" }
export function parseMoney(input: string, localeHint?: string): ParsedMoney | null;
```

Doit supporter `1234.56`, `1234,56`, `1 234,56`, `1.234,56`, `1,234.56`, signes négatifs — jamais `parseFloat` naïf sur un format ambigu. Sortie finale toujours en valeur décimale exacte, jamais en `number` flottant pour le résultat métier.

### 4.6 Dates
Formats supportés : `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`, `MM/DD/YYYY`, `YYYY/MM/DD`. Une date ambiguë (ex. `03/04/2026` sans indication de locale) n'est **jamais** devinée silencieusement : demander confirmation ou utiliser la locale explicitement sélectionnée à l'onboarding. Dates impossibles (`31/02/2026`, `2026-02-30`) rejetées.

---

## 5. Pipeline PDF

Le PDF fait partie de la V1 mais reste contrôlé — ne jamais promettre une compatibilité universelle.

```
Réception du fichier
 ↓
Extraction du texte (bibliothèque d'extraction PDF côté serveur, jamais côté mobile)
 ↓
Segmentation en lignes candidates de transaction
 ↓
Classification par ligne : date / description / montant détectés ou non
 ↓
Score de confiance par ligne (HIGH / MEDIUM / LOW)
 ↓
Aperçu avec lignes incertaines signalées explicitement
 ↓
Correction utilisateur des lignes incertaines
 ↓
Confirmation
 ↓
Insertion (mêmes règles de validation que le CSV)
```

```ts
export interface PdfExtractedLine {
  rawText: string;
  parsedDate: string | null;
  parsedAmount: string | null;
  parsedDescription: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}
```

Message produit obligatoire affiché à l'utilisateur avant tout import PDF : « Compatible avec les relevés PDF présentant une structure lisible. Vérifiez toujours les résultats avant confirmation. » Ne jamais afficher une promesse de compatibilité totale avec « tous les relevés PDF ».

**Décision produit (définitive) :** le PDF (flux le plus coûteux à traiter et le moins fiable des deux) est réservé à l'offre Plus — Free n'y a droit qu'à un import PDF d'essai très limité (voir `specs/paiement-in-app.md` §2, entitlement `pdfImportEnabled`). Le CSV, gratuit et solide, reste l'expérience de référence en Free et l'argument de mise à niveau naturel vers Plus repose sur le PDF (et sur les imports/abonnements illimités).

---

## 6. Débits, crédits, remboursements

```ts
export type TransactionDirection = "DEBIT" | "CREDIT";
```

Un crédit peut être un remboursement, un avoir, un dépôt ou un mouvement non pertinent. Ne jamais convertir automatiquement un crédit en dépense négative sans conserver sa nature. Un remboursement identifié (même commerçant, montant opposé, fenêtre temporelle proche) est exclu du total des dépenses et de l'historique utilisé par le moteur de récurrence.

---

## 7. Lignes invalides

```ts
export interface ParsedRow {
  rowNumber: number;
  status: "VALID" | "INVALID" | "DUPLICATE" | "REFUND" | "SKIPPED";
  raw: Record<string, string>;
  parsed?: {
    merchantRaw: string;
    amount: string;
    currency: string;
    date: string;
    direction: TransactionDirection;
  };
  errors: Array<{ code: string; field?: string; message: string }>;
}
```

Codes d'erreur : `CSV_MISSING_DATE`, `CSV_INVALID_DATE`, `CSV_MISSING_DESCRIPTION`, `CSV_MISSING_AMOUNT`, `CSV_INVALID_AMOUNT`, `CSV_AMBIGUOUS_DATE`, `CSV_INVALID_CURRENCY`, `CSV_DUPLICATE`, `CSV_REFUND`, `PDF_LOW_CONFIDENCE_LINE`. Une ligne invalide n'est **jamais** insérée silencieusement.

---

## 8. Détection des doublons

Score déterministe : même utilisateur + même date + même montant + même devise + commerçant normalisé équivalent.

```ts
export interface DuplicateCandidate {
  existingExpenseId: string;
  importedRowNumber: number;
  reason: string;
  confidence: "HIGH" | "MEDIUM";
}
```

Un doublon `HIGH` est exclu de l'insertion. Un doublon `MEDIUM` est présenté à l'utilisateur pour arbitrage. Aucune tolérance financière arbitraire (seule une tolérance de format sur le nom de commerçant est admise).

---

## 9. Normalisation des commerçants

```
apps/api/src/lib/merchant/normalize.ts
```

```ts
export interface MerchantNormalizationResult {
  raw: string;
  normalized: string;
  tokens: string[];
}
export function normalizeMerchant(merchantRaw: string): MerchantNormalizationResult;
```

Pipeline déterministe (aucune dépendance réseau) : trim → normalisation Unicode → minuscules → espaces multiples réduits → suppression des caractères de contrôle → normalisation des séparateurs → suppression des identifiants transactionnels évidents → suppression des domaines connus → suppression des suffixes géographiques connus → alias connus → capitalisation d'affichage.

Exemples attendus : `"NETFLIX.COM AMSTERDAM"` → `"Netflix"` ; `"SPOTIFY AB STOCKHOLM"` → `"Spotify"`. Ne jamais supprimer arbitrairement un chiffre significatif (`"7-ELEVEN"` ne doit pas devenir `"ELEVEN"`).

Alias déterministes centralisés :

```ts
export interface MerchantAliasRule { pattern: RegExp; normalized: string }
export const MERCHANT_ALIAS_RULES: MerchantAliasRule[] = [
  { pattern: /^netflix(?:\.com)?(?:\s+.*)?$/i, normalized: "Netflix" },
];
```

Correction manuelle (`Expense.merchantOverride`) toujours prioritaire :

```ts
function getEffectiveMerchantName(e: { merchantNormalized: string; merchantOverride?: string | null }): string {
  return e.merchantOverride?.trim() || e.merchantNormalized;
}
```

---

## 10. Identifiant de lot & rollback

Voir modèle `ExpenseImportBatch` dans `specs/schema-donnees.md`.

```
POST /api/imports/preview      (multipart/form-data, champ "file", CSV ou PDF)
POST /api/imports/confirm
POST /api/imports/:id/rollback
GET  /api/imports/:id
```

```ts
export interface ConfirmImportInput {
  importId: string;
  mapping?: CsvColumnMapping;
  acceptedRows: number[];
  rejectedRows: number[];
}
```

Rollback :
- Vérifie `batch.userId === session.user.id`.
- Supprime **uniquement** les `Expense` créées par ce lot (jamais les transactions existantes utilisées pour la détection de doublons).
- Marque `rolledBackAt = now()` ; un lot déjà annulé ne peut pas être annulé une seconde fois.

---

## 11. Sécurité CSV/PDF

- Fichier stocké en zone temporaire isolée, jamais exposé publiquement.
- Suppression immédiate après traitement, y compris en cas d'échec (bloc `finally`).
- Rejet de tout fichier contenant des scripts, macros, HTML, exécutables, ou données binaires non reconnues.
- Rate limiting dédié sur `import:upload`.

---

## 12. Tests unitaires obligatoires

`tests/unit/csv-parser.test.ts` :
- [ ] Séparateur `,`, `;`, tabulation détectés.
- [ ] Champs quotés, guillemets échappés, virgule dans un champ conservée.
- [ ] UTF-8, UTF-8 BOM, ISO-8859-1 acceptés ; accents conservés.
- [ ] Fichier vide rejeté ; trop de lignes rejeté ; fichier trop volumineux rejeté.
- [ ] Colonnes Date/Description/Montant absentes signalées.

`tests/unit/amount-parsing.test.ts` :
- [ ] `"12.99"`, `"12,99"`, `"1 234,56"`, `"1.234,56"`, `"1,234.56"` correctement interprétés selon le contexte.
- [ ] Aucun calcul métier final en flottant.

`tests/unit/date-parsing.test.ts` :
- [ ] Formats valides acceptés selon locale connue ; dates impossibles rejetées ; dates ambiguës signalées, jamais devinées.

`tests/unit/duplicate-detection.test.ts` :
- [ ] Doublon certain exclu ; doublon probable signalé ; aucun doublon entre utilisateurs différents.

`tests/unit/merchant-normalization.test.ts` :
- [ ] Variantes connues regroupées ; `merchantRaw` inchangé ; correction manuelle prioritaire ; déterminisme (deux exécutions identiques → même résultat).

`tests/integration/import-isolation.test.ts` :
- [ ] User A ne peut pas consulter/rollback un import de User B.
- [ ] Rollback d'un lot déjà annulé rejeté.
- [ ] Fichier source supprimé après traitement, y compris après une erreur de traitement.

---

## 13. Checklist d'acceptation

- [ ] CSV et PDF supportés comme parcours principal ; saisie manuelle reléguée à un usage de correction/complément.
- [ ] Encodages et séparateurs gérés ; dates et montants ambigus jamais devinés silencieusement.
- [ ] Débits/crédits/remboursements distingués.
- [ ] Doublons détectés selon un score déterministe.
- [ ] Preview obligatoire avant tout import définitif ; confirmation explicite requise.
- [ ] Rollback disponible, strictement limité au lot du propriétaire.
- [ ] Fichier source jamais conservé durablement.
- [ ] PDF accompagné du message de compatibilité limitée, lignes incertaines toujours signalées.