# specs/paiement-in-app.md — Paiement in-app (Google Play Billing & Apple StoreKit)

Niveau : intégration standard (SDK de plateforme + webhooks/notifications serveur), pas d'algorithme métier custom. **Aucune intégration Stripe.**

---

## 1. Principe

Le navigateur/mobile ne décide jamais du plan, du statut, ou de la date de fin de période. La source de vérité est la notification serveur envoyée par le store :

```
Notification serveur du store (Play / Apple)
      ↓
apps/api (vérification + traitement idempotent)
      ↓
Subscription (specs/schema-donnees.md)
      ↓
Entitlements
```

Le paiement par carte (Visa et autres réseaux principaux) est pris en charge **nativement** par le compte Google Play / Apple ID de l'utilisateur — L'application ne saisit, ne stocke, ni ne traite aucune donnée de carte bancaire.

---

## 2. Matrice fonctionnelle V1 (Free / Plus uniquement)

| Fonctionnalité | Free | Plus |
|---|---|---|
| Import CSV | 1 import, période limitée | Illimité |
| Import PDF | Test/limité | Illimité, relevés plus longs |
| Abonnements détectés | Jusqu'à 5 | Illimité |
| Dashboard | Basique | Avancé |
| Alertes de hausse de prix | Non | Oui |
| Comparaison | Limitée | Avancée |
| Objectifs d'épargne | 1 | Multiples |
| Historique complet | Non | Oui |
| Résumé IA mensuel (3 usages bornés) | Limité (quota réduit) | Quota supérieur |
| Langues | 3 | 3 |
| Support | — | Standard |

Aucune ligne « Pro », « multi-profils », « règles personnalisées » n'existe en V1 (reportées, voir `RECAP_FONCTIONNALITES.md`).

---

## 3. Configuration serveur

```
# Google Play
GOOGLE_PLAY_PACKAGE_NAME=
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON=
GOOGLE_PLAY_PLUS_MONTHLY_PRODUCT_ID=
GOOGLE_PLAY_PLUS_YEARLY_PRODUCT_ID=

# Apple App Store
APP_STORE_BUNDLE_ID=
APP_STORE_ISSUER_ID=
APP_STORE_KEY_ID=
APP_STORE_PRIVATE_KEY=
APP_STORE_PLUS_MONTHLY_PRODUCT_ID=
APP_STORE_PLUS_YEARLY_PRODUCT_ID=
```

Aucun de ces secrets n'est exposé à `apps/mobile`.

```ts
export const PLANS = {
  FREE: { monthlyPriceMinor: 0n, yearlyPriceMinor: 0n },
  PLUS: { monthlyPriceMinor: 599n, yearlyPriceMinor: 4999n }, // EUR, unités mineures
} as const;
```

Les prix affichés dans l'app proviennent en réalité du **store** (Play Console / App Store Connect gèrent le prix localisé réel par pays) ; `PLANS` ci-dessus sert de référence de configuration/fallback d'affichage, jamais de source de facturation.

---

## 4. Achat depuis le mobile

```
POST /api/billing/purchase/verify
```

```ts
export const verifyPurchaseSchema = z.object({
  store: z.enum(["GOOGLE_PLAY", "APP_STORE"]),
  productId: z.string(),
  purchaseToken: z.string().optional(),       // Android
  transactionId: z.string().optional(),       // iOS
});
```

Flux :
1. `apps/mobile` déclenche l'achat via le SDK natif du store (Google Play Billing Library / StoreKit 2).
2. Le store renvoie un jeton d'achat / une transaction signée au client.
3. Le client transmet ce jeton à `POST /api/billing/purchase/verify`.
4. Le serveur vérifie le jeton directement auprès de l'API du store (Google Play Developer API / App Store Server API) — **jamais** de confiance aveugle dans ce que le client affirme.
5. Le serveur met à jour `Subscription` uniquement si la vérification réussit.
6. Le mobile relit ensuite `GET /api/billing/subscription` : le plan affiché est celui **résolu par le serveur**, jamais déduit de la réponse d'achat.

SDK retenu : **`expo-iap`**, qui parle directement à Google Play Billing et à StoreKit 2 et rend le jeton brut. RevenueCat (`react-native-purchases`) a été écarté : c'est un back-office de facturation complet, alors que la vérification est déjà faite ici, directement auprès des API des stores — le garder aurait créé deux sources de vérité pour l'abonnement (voir `CLAUDE.md` §10.11).

Deux contraintes imposées par les stores structurent le parcours mobile :

1. **L'achat est événementiel.** `requestPurchase()` ne résout pas avec la transaction : la preuve arrive par `purchaseUpdatedListener`. Attendre la valeur de retour laisserait passer des achats.
2. **L'acquittement vient après la vérification serveur.** `finishTransaction()` n'est appelé qu'une fois le plan accordé par le serveur. Un achat Android non acquitté sous **3 jours est remboursé automatiquement** par Google ; une transaction iOS non terminée est rejouée à chaque lancement.

Contrainte d'exécution : le SDK natif n'existe **pas dans Expo Go**. Il est donc chargé par un `require` isolé (`apps/mobile/lib/native-purchases.ts`) et son absence est un état déclaré, pas une erreur — l'écran d'offres reste consultable et annonce que l'achat exige un *development build* (`eas build --profile development`). Il n'existe **aucun repli simulant un achat** : sans preuve délivrée par le store, rien n'est envoyé au serveur et aucun plan n'est accordé.

La facturation directe n'a **aucune clé côté client**. Les identifiants de produits sont configurés des deux côtés : `EXPO_PUBLIC_PLUS_MONTHLY_PRODUCT_ID` / `EXPO_PUBLIC_PLUS_YEARLY_PRODUCT_ID` côté mobile (valeurs publiques, visibles sur la fiche du store) et `GOOGLE_PLAY_PLUS_*_PRODUCT_ID` / `APP_STORE_PLUS_*_PRODUCT_ID` côté serveur. Un identifiant absent de la configuration **serveur** est refusé (§3) : un produit fabriqué côté client n'accorde donc rien.

---

## 5. Notifications serveur des stores (équivalent des webhooks Stripe)

```
POST /api/webhooks/google-play    (Real-Time Developer Notifications)
POST /api/webhooks/app-store      (App Store Server Notifications V2)
```

Traitement obligatoire :
1. Vérifier l'authenticité de la notification (signature JWT pour Apple, format Pub/Sub pour Google).
2. Vérifier l'idempotence via `StoreNotificationEvent` (voir `specs/schema-donnees.md` §12) : ID déjà traité → ne pas retraiter.
3. Mettre à jour `Subscription` dans une transaction.
4. Journaliser l'événement sans donnée sensible.
5. Répondre rapidement 2xx.

Événements Google Play à traiter au minimum : `SUBSCRIPTION_PURCHASED`, `SUBSCRIPTION_RENEWED`, `SUBSCRIPTION_CANCELED`, `SUBSCRIPTION_EXPIRED`, `SUBSCRIPTION_ON_HOLD`, `SUBSCRIPTION_IN_GRACE_PERIOD`.
Événements Apple à traiter au minimum : `SUBSCRIBED`, `DID_RENEW`, `DID_CHANGE_RENEWAL_STATUS` (autoRenewStatus), `EXPIRED`, `GRACE_PERIOD_EXPIRED`.

---

## 6. Règle prioritaire — résiliation ⇒ accès conservé jusqu'à la fin de la période déjà payée

**Décision produit (définitive) :** à la résiliation, l'utilisateur conserve l'accès aux fonctionnalités payantes jusqu'à `currentPeriodEnd` — pratique standard partout (Netflix, Spotify, etc.). Couper l'accès immédiatement sur une période déjà réglée est le type de détail qui génère avis négatifs et demandes de remboursement, pour un gain de simplicité technique minime. Techniquement, cela se traduit ainsi :

- Google Play envoie `SUBSCRIPTION_CANCELED` **au moment où l'utilisateur désactive le renouvellement automatique**, bien avant la fin de la période déjà payée. Apple envoie `DID_CHANGE_RENEWAL_STATUS` avec `autoRenewStatus: false` au même moment.
- Dès réception de l'un de ces événements, le serveur exécute **uniquement** :

```ts
await prisma.subscription.update({
  where: { userId },
  data: { cancelAtPeriodEnd: true, canceledAt: new Date() },
});
// plan et status ne changent PAS ici : l'accès payant continue jusqu'à currentPeriodEnd
```

- Le passage effectif à `FREE` n'intervient qu'à l'expiration réelle de la période, sur réception de `SUBSCRIPTION_EXPIRED` (Google) ou `EXPIRED` (Apple) — ou par un job planifié qui vérifie `currentPeriodEnd < now()` en secours si la notification d'expiration n'arrivait pas :

```ts
await prisma.subscription.update({
  where: { userId },
  data: { plan: "FREE", status: "EXPIRED" },
});
```

- Cette logique est isolée dans deux fonctions distinctes (`applyCancellation` et `applyExpiration`) pour rester testable indépendamment.
- Un échec de paiement non résolu (`SUBSCRIPTION_ON_HOLD` / grace period expirée) suit sa propre politique (§5) — ce n'est pas une résiliation volontaire et ne doit pas être confondu avec elle.
- `getEntitlements(subscription.plan)` continue de retourner les entitlements `PLUS` tant que `plan !== "FREE"`, y compris lorsque `cancelAtPeriodEnd === true` : l'accès reste inchangé jusqu'à l'expiration effective.

---

## 7. Entitlements

```ts
export interface Entitlements {
  maxCsvImportsPerMonth: number | null;
  pdfImportEnabled: boolean;
  maxTrackedSubscriptions: number | null;
  priceIncreaseAlerts: boolean;
  advancedComparisons: boolean;
  savingsGoalsLimit: number | null;
  fullHistory: boolean;
  aiMonthlyCredits: number;
}

function getEntitlements(plan: "FREE" | "PLUS"): Entitlements {
  // configuration serveur centralisée, jamais dispersée dans les composants mobile
}
```

Toute fonctionnalité payante est contrôlée **côté serveur** par `getEntitlements(subscription.plan)` — jamais par un état local de l'application mobile.

---

## 8. Lien avec la suppression de compte

Voir `specs/auth-comptes-rgpd.md` §9 : la suppression de compte est bloquée uniquement si l'abonnement est **encore actif et non résilié** (`plan !== "FREE"` **et** `cancelAtPeriodEnd === false`). Dès que `cancelAtPeriodEnd` passe à `true` (résiliation), la suppression est débloquée **immédiatement** — même si l'utilisateur conserve encore l'accès payant jusqu'à `currentPeriodEnd` d'après la règle §6. Le parcours utilisateur devient donc : **Résilier → suppression de compte immédiatement possible, indépendamment de l'accès payant restant**. Si l'utilisateur choisit de supprimer son compte avant la fin de sa période déjà payée, la suppression reste irréversible et prioritaire : le compte et toutes ses données sont supprimés immédiatement, sans lien avec le temps d'accès payant restant (qui devient simplement sans objet).

---

## 9. Rappels & notifications

- Pas d'e-mail transactionnel Stripe : les rappels (ex. fin d'essai si un essai est activé plus tard) passent par notification push native (Expo Notifications) ou e-mail transactionnel simple (fournisseur abstrait, voir variables `EMAIL_PROVIDER`/`EMAIL_FROM` dans `.env.example`).
- Aucun essai gratuit n'est requis pour la V1 ; s'il est ajouté, respecter les règles de présentation des stores (durée exacte affichée, prix après essai visible, annulation possible depuis les paramètres d'abonnement du store).

---

## 10. Tests obligatoires

- [ ] Achat Plus mensuel vérifié côté serveur (sandbox Google Play + sandbox Apple).
- [ ] Achat Plus annuel vérifié côté serveur (sandbox Google Play + sandbox Apple).
- [ ] Notification `SUBSCRIPTION_CANCELED` / `autoRenewStatus:false` met à jour uniquement `cancelAtPeriodEnd = true` — le plan et l'accès payant restent inchangés.
- [ ] Notification `SUBSCRIPTION_EXPIRED` / `EXPIRED` (ou job de secours sur `currentPeriodEnd` dépassé) déclenche seule le repassage effectif à `FREE`.
- [ ] Un utilisateur résilié conserve l'accès payant jusqu'à `currentPeriodEnd` (test explicite : achat → résiliation → vérification de l'accès encore actif → avance de la date → vérification du passage à `FREE`).
- [ ] Notification dupliquée (rejouée) n'est traitée qu'une seule fois (idempotence).
- [ ] Un utilisateur ne peut pas modifier son propre plan par une requête client arbitraire (le plan ne peut changer que via `verify` ou notification serveur).
- [ ] Suppression de compte bloquée uniquement tant que l'abonnement Plus reste actif et non résilié ; débloquée immédiatement dès la résiliation, sans attendre la fin de la période payée.

---

## 11. Checklist d'acceptation

- [ ] Aucune trace de Stripe dans le code, les variables d'environnement, ou le schéma.
- [ ] Achats vérifiés côté serveur pour les deux stores.
- [ ] Notifications serveur des deux stores traitées de façon idempotente.
- [ ] Entitlements centralisés côté serveur, jamais dispersés côté mobile.
- [ ] Résiliation → accès payant conservé jusqu'à la fin de la période déjà payée, puis repassage à `FREE` à l'expiration (règle §6 appliquée et testée).
- [ ] Suppression de compte cohérente avec l'état d'abonnement (voir `specs/auth-comptes-rgpd.md`).