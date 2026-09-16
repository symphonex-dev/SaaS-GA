# ACTIONS_MANUELLES.md — Démarches manuelles hors code

Ce guide liste, étape par étape, tout ce qui doit être fait **en dehors** de Claude Code : création de comptes tiers, configuration de consoles, DNS, déploiement. Aucune de ces actions n'est automatisable par le code.

---

## 1. Base de données PostgreSQL (Supabase ou Neon)

1. Créer un compte sur Supabase **ou** Neon.
2. Créer un nouveau projet PostgreSQL.
3. Récupérer l'URL de connexion pooling (`DATABASE_URL`) et l'URL directe (`DIRECT_DATABASE_URL`) — nécessaire pour les migrations Prisma.
4. Renseigner ces deux valeurs dans `apps/api/.env.local` (jamais commité).
5. Activer les sauvegardes automatiques si l'offre le permet.

---

## 2. Compte Expo / EAS (build mobile)

1. Créer un compte sur expo.dev.
2. Installer `eas-cli` en local (`npm install -g eas-cli`).
3. `eas login`, puis `eas init` dans `apps/mobile` pour lier le projet.
4. Configurer `eas.json` avec au minimum un profil `development`, un profil `preview` (tests internes) et un profil `production` — les trois existent déjà dans le dépôt.
5. Générer les identifiants de build Android (keystore géré par EAS) et iOS (certificats gérés par EAS, nécessite un compte Apple Developer, voir §4).

### 2.0 Versionnage des builds

`eas.json` est en **versionnage distant** (`cli.appVersionSource: "remote"`), et le profil `production` incrémente automatiquement le numéro de build (`autoIncrement`). Concrètement :

- `version` (`app.config.ts`) est la version **affichée** : c'est vous qui la faites évoluer, à chaque livraison fonctionnelle ;
- `versionCode` (Android) et `buildNumber` (iOS) sont gérés par EAS, jamais écrits dans le dépôt.

Après `eas init`, aligner le compteur distant sur ce qui existe déjà sur les boutiques :

```bash
eas build:version:set --platform android
eas build:version:set --platform ios
```

Sans cette étape, le premier build de production repart de 1 et la boutique refuse la soumission (« version déjà utilisée »).

### 2.1 Icônes et écran de démarrage

`apps/mobile/assets/` contient une icône, une icône adaptative Android et une image de démarrage **réelles et valides**, produites par `assets/generate-assets.mjs` (script Node sans dépendance, à relancer après toute modification) :

```bash
node apps/mobile/assets/generate-assets.mjs apps/mobile/assets
```

Ce sont des visuels de travail, pas une identité graphique. **À remplacer avant soumission** par des fichiers de même nom et mêmes dimensions (1024 × 1024) fournis par un graphiste. Contraintes des boutiques : l'icône iOS ne doit pas être transparente, et le premier plan de l'icône adaptative Android doit tenir dans les 66 % centraux.

### 2.2 Ce qui se teste dans Expo Go, et ce qui exige un *development build*

Expo Go n'embarque que les modules natifs du SDK. Le reste de l'application y fonctionne intégralement — onboarding, création de compte, import CSV/PDF, tableau de bord, abonnements, comparateur, économies, assistant IA, paramètres, export et suppression de compte.

**Seul l'achat in-app** exige un build natif : `expo-iap` n'existe pas dans Expo Go. L'écran d'offres reste consultable et l'annonce explicitement ; aucun repli ne simule un achat.

```bash
npx eas build --profile development --platform android
```

`expo-dev-client` **doit rester déclaré dans `apps/mobile/package.json`** — c'est ce qui embarque le lanceur de développement dans l'APK. L'autolinking d'Expo part des dépendances du projet Expo : installé ailleurs (à la racine du monorepo, par exemple), le paquet est présent dans `node_modules` mais n'est **pas lié**, et l'APK démarre sans écran de sélection de serveur, se fige, puis déclenche un ANR. Un test structurel garde cette déclaration (`CLAUDE.md` §10.12).

Effet de bord assumé : avec `expo-dev-client` installé, `npm run dev:mobile` démarre en mode development build. La recette quotidienne dans Expo Go reste accessible d'une option :

```bash
npm run dev:mobile:go     # expo start --go, depuis la racine du monorepo
```

Avant le build, renseigner les identifiants de produits dans `apps/mobile/.env` (voir `apps/mobile/.env.example`). Les secrets de vérification, eux, restent exclusivement côté serveur (§3 et §4 ci-dessous).

---

## 3. Google Play Console (prioritaire — V1 Android)

1. Créer un compte développeur Google Play (frais unique à la charge du porteur de projet).
2. Créer une nouvelle application, renseigner le nom localisé par langue dans la fiche store (voir `CLAUDE.md` §1) : `en` → **Subscription Manager**, `fr` → **Gestionnaire d'abonnements**, `es` → **Gestor de suscripciones**.
3. Remplir le questionnaire de classification de contenu.
4. Remplir la section **Data safety** (« Sécurité des données ») en cohérence avec `RECAP_FONCTIONNALITES.md` §7 : préciser qu'aucune donnée n'est partagée à des fins publicitaires, qu'aucun SDK d'analytics comportemental n'est utilisé, et lister précisément les données collectées (e-mail, préférences, dépenses saisies/importées) et leur finalité.
5. Renseigner l'URL publique de la politique de confidentialité (page `apps/api` `/[locale]/privacy`, déployée — voir §7).
6. Dans **Monetization → Products → Subscriptions**, créer les produits d'abonnement `PLUS` mensuel et annuel (les identifiants doivent correspondre exactement à `GOOGLE_PLAY_PLUS_MONTHLY_PRODUCT_ID` / `GOOGLE_PLAY_PLUS_YEARLY_PRODUCT_ID`).
7. Créer un compte de service (Service Account) dans Google Cloud Console avec accès à l'API Google Play Developer ; télécharger la clé JSON et la renseigner dans `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (jamais commitée).
8. Configurer les **Real-Time Developer Notifications** (Pub/Sub) pour pointer vers `POST /api/webhooks/google-play` une fois l'API déployée.
9. Publier d'abord sur la piste **Internal testing**, puis **Closed testing**, avant la production.
10. Vérifier la conformité au niveau d'API cible (target API level) exigé par Google Play au moment de la publication (cette exigence évolue régulièrement — vérifier la valeur courante sur la Play Console avant de soumettre).

---

## 4. Apple Developer Program & App Store Connect (V1 publiée après Android)

1. Créer/valider un compte Apple Developer Program (abonnement annuel).
2. Créer l'application dans App Store Connect, avec le même nom localisé par langue qu'en §3 (`en` → **Subscription Manager**, `fr` → **Gestionnaire d'abonnements**, `es` → **Gestor de suscripciones**).
3. Remplir la fiche de confidentialité (« App Privacy » / nutrition label) en cohérence avec `RECAP_FONCTIONNALITES.md` §7.
4. Renseigner l'URL publique de la politique de confidentialité.
5. Dans **Subscriptions**, créer un groupe d'abonnement et les produits `PLUS` mensuel/annuel (identifiants correspondant à `APP_STORE_PLUS_MONTHLY_PRODUCT_ID` / `APP_STORE_PLUS_YEARLY_PRODUCT_ID`).
6. Générer une clé App Store Connect API (In-App Purchase / App Store Server API) : récupérer `APP_STORE_ISSUER_ID`, `APP_STORE_KEY_ID`, `APP_STORE_PRIVATE_KEY`.
7. Configurer les **App Store Server Notifications V2** pour pointer vers `POST /api/webhooks/app-store`.
8. Publier d'abord via **TestFlight** avant la soumission App Store.

---

## 5. Fournisseur d'e-mail transactionnel

1. Créer un compte chez un fournisseur d'e-mail transactionnel (ex. Resend ou équivalent).
2. Vérifier le domaine d'envoi (SPF/DKIM) via les DNS (voir §7).
3. Récupérer la clé API et la renseigner dans `EMAIL_PROVIDER_API_KEY`.
4. Configurer `EMAIL_FROM` / `EMAIL_REPLY_TO`.

---

## 6. Fournisseur IA

1. Créer un compte chez le fournisseur d'IA choisi pour les 3 usages bornés (`specs/comparateur-et-assistant-ia.md` Partie B).
2. Générer une clé API, la renseigner dans `AI_API_KEY` (jamais exposée côté mobile).

---

## 6 bis. Fournisseur d'e-mail transactionnel (bloquant pour la production)

Sans lui, une demande de « mot de passe oublié » reste **définitivement sans réponse** : l'utilisateur est enfermé dehors. Le serveur refuse d'ailleurs de démarrer en production tant que ce n'est pas configuré.

1. Créer un compte chez le fournisseur (Resend par défaut — l'API attendue est `POST /emails`).
2. **Vérifier le domaine d'envoi** (enregistrements DNS SPF et DKIM fournis par le fournisseur). Un expéditeur non vérifié est refusé, ou classé en indésirable.
3. Renseigner côté serveur uniquement :
   - `EMAIL_PROVIDER="resend"` ;
   - `EMAIL_PROVIDER_API_KEY` — secret, jamais préfixé `NEXT_PUBLIC_` ni `EXPO_PUBLIC_` ;
   - `EMAIL_FROM` — par exemple `Gestionnaire d'abonnements <no-reply@votre-domaine>` ;
   - `EMAIL_REPLY_TO` — facultatif, une adresse réellement relevée.
4. Vérifier de bout en bout : demander une réinitialisation depuis l'application, recevoir le message, ouvrir le lien profond, changer le mot de passe.
5. Pour un autre fournisseur, seul `EMAIL_API_BASE_URL` change si son API est compatible ; sinon, adapter `apps/api/src/lib/mail/mailer.ts` — c'est le seul fichier concerné.
3. Définir les quotas mensuels par plan (`AI_MONTHLY_CREDITS_FREE`, `AI_MONTHLY_CREDITS_PLUS`) selon le budget cible.

---

## 7. Déploiement `apps/api` (Vercel) & DNS

1. Créer un compte Vercel, lier le dépôt Git.
2. Configurer le projet pour déployer uniquement `apps/api` (monorepo — définir le « Root Directory » sur `apps/api`).
3. Renseigner toutes les variables d'environnement serveur dans Vercel (jamais dans le dépôt).
4. Acheter/configurer un nom de domaine, pointer les enregistrements DNS vers Vercel.
5. Vérifier que les pages publiques légales (`/en/privacy`, `/fr/privacy`, `/es/privacy`, etc.) sont accessibles publiquement une fois déployées — leur URL est requise dans Google Play Console et App Store Connect.

---

## 7 bis. Base d'offres de comparaison (production)

Le seed (`npm run db:seed`) ne contient que des offres **de démonstration**, refusées en production, et dont la prochaine vérification est déjà dépassée : elles n'apparaîtraient de toute façon nulle part. La base de production est alimentée **à la main, offre par offre**, par les routes d'administration (`specs/comparateur-et-assistant-ia.md` A.8). Aucune offre n'est collectée ni générée automatiquement.

### Accès administrateur

1. Créer le compte administrateur depuis l'application (inscription normale).
2. Sur Vercel, renseigner `ADMIN_EMAILS` avec son adresse (plusieurs adresses : séparées par des virgules), puis redéployer. Vide, **personne** n'est administrateur.
3. Obtenir un jeton de session : `POST /api/auth/login` avec `{ "email", "password" }` ; le jeton est dans `data.token`. Il se transmet en `Authorization: Bearer <jeton>` et ne doit jamais être collé dans un ticket ou un dépôt.

### Saisir une offre réellement vérifiée

`POST /api/admin/comparison-offers`, corps JSON :

```json
{
  "serviceName": "Netflix",
  "country": "FR",
  "price": { "minorUnits": "<prix constaté, en centimes>", "currency": "EUR" },
  "billingCycle": "MONTHLY",
  "featuresIncluded": ["<formule et fonctionnalités, telles qu'affichées>"],
  "limits": {},
  "commitmentDuration": null,
  "directOfficialUrl": "https://<page tarifaire officielle du pays>",
  "lastVerifiedAt": "<instant où le prix a été constaté, ISO 8601>",
  "nextCheckAt": "<lastVerifiedAt + 30 jours au plus>",
  "affiliateNote": null,
  "affiliateUrl": null
}
```

Règles, toutes vérifiées par le serveur sauf mention contraire :

- **Prix constaté sur la page officielle du pays et dans sa devise**, relevé par une personne. Jamais un prix estimé, converti ou généré. *(Non vérifiable par le serveur : c'est la responsabilité de l'administrateur.)*
- **`serviceName` = nom du commerçant tel que l'application le normalise**, par exemple « Netflix », « Spotify », « Disney+ », « Amazon Prime », « YouTube Premium », « Google One », « iCloud », « Microsoft 365 », « Deezer », « Canal+ » (alias de `MERCHANT_ALIAS_RULES`, `apps/api/src/lib/merchant/normalize.ts`) ; pour un autre commerçant, le nom affiché dans la liste des abonnements de l'application. Casse, accents et ponctuation sont ignorés. Un nom plus long (« Netflix Standard ») ne donne qu'une correspondance *suggérée* : l'offre est affichée, mais **jamais recommandée ni comptée** dans les économies. Le nom de la formule va dans `featuresIncluded`, affiché tel quel (non traduit).
- **Pays et devise cohérents avec les utilisateurs visés** : une offre n'est proposée qu'à un utilisateur de **même pays et même devise**.
- **`lastVerifiedAt` ne peut pas être dans le futur** (tolérance de 5 minutes), et `nextCheckAt` doit lui être postérieur.
- **`directOfficialUrl` en HTTPS**, obligatoire. Un `affiliateUrl` exige son `affiliateNote` (mention de commission affichée à côté du lien).
- Chaque création, modification, revérification et suppression est journalisée (qui, quand, avant/après) dans la même transaction que l'écriture : `GET /api/admin/comparison-offers/<id>`.

### Cycle de fraîcheur

| Âge de la vérification | État | Effet dans l'application |
|---|---|---|
| ≤ 30 jours, avant `nextCheckAt` | `FRESH` | affichée ; recommandée et comptée si l'économie est positive |
| > 30 jours, avant `nextCheckAt` | `STALE` | affichée « obsolète », jamais recommandée ni comptée |
| après `nextCheckAt` | `EXPIRED` | n'apparaît plus nulle part |

Avec `nextCheckAt` = `lastVerifiedAt` + 30 jours, une offre passe directement de `FRESH` à `EXPIRED`. Une échéance plus lointaine la laisse visible comme obsolète.

**Revérification** (au plus tous les 30 jours) : `POST /api/admin/comparison-offers/<id>/verify` avec `{ "verifiedAt", "nextCheckAt" }`, plus `"price"` si le prix a changé (même devise obligatoire). C'est le seul moyen de rendre une offre à nouveau `FRESH`. Pour repérer les offres à revoir : `GET /api/admin/comparison-offers?country=FR` renvoie toutes les offres, périmées comprises, avec leurs dates. Une offre abandonnée se retire par `DELETE /api/admin/comparison-offers/<id>` (la trace est conservée).

### Aucun job à planifier pour les offres

Le rapprochement est **recalculé à chaque lecture** (`GET /api/comparisons`, `GET /api/comparisons/<expenseId>`, `GET /api/dashboard`), avec l'heure courante : une offre revérifiée réapparaît et une offre échue disparaît sans aucune tâche planifiée. `POST /api/comparisons/<expenseId>/refresh` fait exactement le même calcul à la demande de l'utilisateur ; il ne collecte aucun prix. Le seul job d'exploitation de l'API reste `POST /api/billing/expire-overdue` (facturation, sans rapport avec les offres).

---

## 8. Vérifications manuelles avant publication

- [ ] Les URLs de politique de confidentialité et CGU sont publiques et accessibles sans connexion.
- [ ] Les produits d'abonnement Google Play et Apple ont des identifiants strictement identiques à ceux configurés côté serveur.
- [ ] Un achat test en bac à sable (sandbox) fonctionne sur les deux stores.
- [ ] La section Data safety (Google) et App Privacy (Apple) déclarent bien l'absence de tout tracker publicitaire/analytics tiers.
- [ ] Le nom localisé (Subscription Manager / Gestionnaire d'abonnements / Gestor de suscripciones) est cohérent dans les fiches des deux stores, dans les trois langues.
- [ ] Aucun secret (clé IA, clé de service Google, clé App Store, identifiants base de données) n'est présent dans le dépôt Git.