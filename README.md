# Gestionnaire d'abonnements

Application **mobile** (Android d'abord, iOS ensuite) qui importe un relevé bancaire — CSV ou PDF —, détecte les abonnements et dépenses récurrentes, calcule leur coût réel mensuel et annuel, et propose des économies vérifiées.

Ce dépôt est un monorepo npm : une API, une application mobile, et le code partagé entre les deux.

- Nom affiché par store : `en` → **Subscription Manager**, `fr` → **Gestionnaire d'abonnements**, `es` → **Gestor de suscripciones**. L'identifiant technique reste `subscription-manager`.
- Synthèse produit non technique : [`RECAP_FONCTIONNALITES.md`](RECAP_FONCTIONNALITES.md)
- Source de vérité technique : [`CLAUDE.md`](CLAUDE.md) — **à lire avant toute modification**
- Spécifications détaillées par domaine : [`specs/`](specs/)
- Démarches hors code (comptes stores, DNS, déploiement) : [`ACTIONS_MANUELLES.md`](ACTIONS_MANUELLES.md)

---

## Ce que le produit fait — et ne fait pas

**Fait :** importer un relevé, détecter les récurrences de façon déterministe, calculer les coûts, signaler les hausses de prix, comparer à une petite base d'offres vérifiées à la main, suivre des objectifs d'épargne.

**Ne fait pas :** pas de connexion bancaire (aucun Open Banking), pas de conseil financier ni d'investissement, pas de chatbot, pas de tracker publicitaire ou analytique, pas de Stripe ni de saisie de carte bancaire, pas de mode invité.

Ces limites ne sont pas des raccourcis d'implémentation : ce sont des règles produit, énumérées dans `CLAUDE.md` §5 et vérifiées par des tests.

---

## Prérequis

| Outil | Version | Notes |
|---|---|---|
| Node.js | **≥ 20.11** | imposé par `engines` à la racine |
| npm | ≥ 10 | les workspaces npm sont utilisés, pas pnpm ni yarn |
| PostgreSQL | ≥ 14 | local, Supabase ou Neon (voir `ACTIONS_MANUELLES.md` §1) |
| Expo Go / émulateur | SDK 57 | Android Studio ou Xcode pour lancer l'app mobile |

Aucune compilation native n'est nécessaire pour l'API : Argon2id passe par `@node-rs/argon2`, qui fournit des binaires précompilés.

> **Versions natives épinglées.** `react`, `react-dom`, `react-native-reanimated` et `react-native-worklets` sont déclarés **à la racine du monorepo** en plus de `apps/mobile`. Ce n'est pas un oubli : npm hisse une seule copie de ces paquets, et sans cet épinglage il y installe la version la plus permissive demandée par l'outillage d'Expo — plus récente que la partie native embarquée par Expo Go, ce qui fait échouer l'application au démarrage. `npx expo-doctor` doit rester à 21/21.

---

## Installation

```bash
npm install
```

Puis créer les fichiers d'environnement à partir du modèle. **Deux copies sont nécessaires**, et c'est volontaire :

```bash
cp .env.example apps/api/prisma/.env    # lu par la CLI Prisma (generate / migrate / seed)
cp .env.example apps/api/.env.local     # lu par Next.js à l'exécution
```

`.env.example` ne contient que des valeurs de démonstration — aucun secret réel n'est committé. Les deux fichiers créés sont ignorés par git.

L'application mobile a son propre modèle, qui ne contient **que des valeurs publiques** (voir « Où l'application mobile cherche l'API ») ; il est facultatif en développement local :

```bash
cp apps/mobile/.env.example apps/mobile/.env    # variables EXPO_PUBLIC_* uniquement
```

Générer le client Prisma, appliquer les migrations, puis charger les offres de démonstration :

```bash
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
```

Le seed refuse de s'exécuter avec `NODE_ENV=production` : il ne contient que des offres de comparaison de démonstration, jamais des prix réellement vérifiés.

---

## Lancer le projet

```bash
npm run dev:api        # API + pages légales sur http://localhost:3000
npm run dev:mobile     # Expo (choisir ensuite Android / iOS)
```

### Où l'application mobile cherche l'API

`localhost` ne désigne pas la même machine selon l'endroit où le bundle s'exécute. `apps/mobile/lib/api-config.ts` résout l'URL dans cet ordre :

| Exécution | Ce que `localhost` désigne | URL réellement visée |
|---|---|---|
| Navigateur / simulateur iOS | l'ordinateur | `http://localhost:3000` |
| Émulateur Android | l'émulateur | `http://10.0.2.2:3000` |
| **Téléphone physique (Expo Go)** | **le téléphone** | `http://<IP LAN de l'ordinateur>:3000` |

Sur un téléphone physique, l'adresse LAN n'est **jamais codée en dur** : elle est déduite de l'hôte Metro auquel Expo Go est déjà connecté. Il faut alors que Next.js écoute sur l'interface réseau, et pas seulement sur la boucle locale :

```bash
npm run dev:api:lan    # next dev --hostname 0.0.0.0
```

```
Téléphone (Expo Go) --HTTP LAN--> ordinateur --> Next.js :3000
```

L'ordinateur et le téléphone doivent être sur le même réseau ; un pare-feu qui bloque le port 3000 en entrée empêche la connexion.

Pour viser une autre API (préproduction, production, tunnel), renseigner la variable **publique** correspondante :

```bash
cp apps/mobile/.env.example apps/mobile/.env   # puis EXPO_PUBLIC_API_BASE_URL="https://…"
```

Une URL d'API publique n'est pas un secret. En revanche, **aucune clé ni aucun secret serveur** ne doit être préfixé `EXPO_PUBLIC_` : ces variables sont inlinées en clair dans le bundle distribué.

En développement, une requête en échec écrit un diagnostic dans la console Metro — méthode, URL appelée, code HTTP, cause réseau (DNS / connexion refusée / délai dépassé), plateforme et provenance de l'URL configurée. Il ne contient ni en-tête, ni jeton, ni donnée utilisateur, et n'existe pas en production.

Pour dérouler le parcours « mot de passe oublié » en local, mettre `EMAIL_PROVIDER="console"` : le lien de réinitialisation est écrit dans la sortie standard de l'API. Ce transport est refusé en production — le lien contient le token brut.

---

## Mise en production

Le serveur **refuse de démarrer** en production si l'une de ces variables manque ou reste sur une valeur de développement (`apps/api/src/instrumentation.ts`). Ce n'est pas une précaution excessive : les trois pannes évitées sont invisibles jusqu'à ce qu'un utilisateur les subisse.

| Variable | Valeur exigée | Ce qui casse sinon |
|---|---|---|
| `EMAIL_PROVIDER` | `resend` | Une demande de mot de passe oublié reste sans réponse : l'utilisateur est bloqué hors de son compte. |
| `EMAIL_PROVIDER_API_KEY` | clé du fournisseur | Aucun envoi ne part. |
| `EMAIL_FROM` | expéditeur d'un domaine vérifié | Le fournisseur refuse l'envoi. |
| `RATE_LIMIT_STORE` | `postgres` | Chaque instance compte séparément : avec N instances la limite réelle est N fois la limite annoncée. |
| `IMPORT_PREVIEW_STORE` | `postgres` | La confirmation d'un import échoue dès qu'elle atteint une autre instance, et tout redémarrage perd les aperçus en cours. |

Deux tables portent ces états partagés (migration `20260906120000_shared_stores`) :

- `rate_limit_counters` — compteur à fenêtre fixe, incrémenté par un unique `INSERT … ON CONFLICT DO UPDATE … RETURNING` ;
- `import_previews` — aperçu d'import avec TTL, propriétaire (`user_id`) et consommation unique.

Les deux accumulent des lignes échues. Une purge périodique est à planifier sur la plateforme d'hébergement (`rateLimitRepository.purgeExpired`, `importPreviewRepository.purgeExpired`) ; rien ne dépend de son exécution — une ligne périmée n'est jamais relue, seulement stockée.

### Intégration continue

`.github/workflows/ci.yml` exécute la séquence ci-dessous à chaque poussée, plus une seconde tâche « cohérence Expo » : `expo-doctor`, `expo install --check` et un export du bundle Android. Cette seconde tâche est ce qui empêche une dérive de version native de revenir en douce (`CLAUDE.md` §10.10).

---

## Commandes

Toutes se lancent depuis la racine et s'appliquent aux trois workspaces.

| Commande | Rôle |
|---|---|
| `npm run typecheck` | TypeScript strict sur `apps/api`, `apps/mobile`, `packages/shared` |
| `npm run lint` | ESLint (configuration plate unique, typée) |
| `npm run lint:fix` | Idem, avec correction automatique |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run test` | Vitest — suites de `apps/api` et de `apps/mobile` |
| `npm run dev:api` / `dev:api:lan` | API sur la boucle locale / sur l'interface réseau |
| `npm run dev:mobile` | Serveur Expo |
| `npm run build` | Build de production de `apps/api` |
| `npm run db:generate` | `prisma generate` |
| `npm run db:migrate` | `prisma migrate dev` (développement) |
| `npm run db:migrate:deploy` | `prisma migrate deploy` (CI / production) |
| `npm run db:seed` | Offres de comparaison de démonstration |

Cibler un seul test :

```bash
npm run test --workspace=apps/api -- tests/integration/billing-notifications.test.ts
```

### Séquence CI

```bash
npm ci
npx prisma generate --schema=apps/api/prisma/schema.prisma
npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
```

Le projet n'est pas dans un état stable tant que cette séquence ne passe pas intégralement.

---

## Structure

```
apps/
  api/                    Next.js App Router — API + pages publiques légales
    prisma/               schéma, migrations versionnées, seed
    src/app/api/          38 routes API
    src/app/[locale]/     confidentialité, CGU, cookies, aide, contact (en/fr/es)
    src/lib/              modules purs : csv, pdf, recurring, finance, comparison, billing
    src/server/           services, repositories, auth, entitlements, ai
    tests/                unitaires + intégration (Vitest)
  mobile/                 Expo + Expo Router + NativeWind
    app/                  31 écrans + 2 layouts, routage par fichiers
    components/           briques d'UI partagées
    assets/               icône, icône adaptative, écran de démarrage (+ générateur)
    lib/                  client HTTP, résolution d'URL d'API, hooks TanStack Query,
                          i18n, formatage, isolation du SDK d'achat natif
    locales/              en / fr / es (traductions statiques)
    tests/                logique pure du client (Vitest)
packages/
  shared/                 types, schémas Zod, constantes, moteur financier
specs/                    8 spécifications de domaine
```

**Architecture imposée**, côté API : `route → Zod → requireUser() → service → repository → Prisma`. Aucune requête Prisma n'est écrite directement dans un route handler.

`packages/shared` est consommé **en TypeScript source**, sans étape de build : Metro et le compilateur Next transpilent déjà le paquet.

---

## Règles que le code fait respecter

Ces points ne sont pas des recommandations : ils sont vérifiés par des tests structurels qui échouent si quelqu'un les contourne.

- **Compte obligatoire.** Aucun écran fonctionnel, aucune route API hors `/api/auth/*` n'est accessible sans session valide. Pas d'aperçu avant inscription.
- **Isolation par `userId`.** Toute ressource privée est filtrée par l'utilisateur de la session ; celle d'un autre compte est traitée comme inexistante, jamais « trouvée puis refusée ».
- **Aucun flottant monétaire.** Tout calcul se fait en unités mineures entières (`bigint`), stockage en `Decimal(19,4)`. Le mobile ne calcule **aucun** montant : il affiche des DTO déjà arrêtés par le serveur.
- **Aucune conversion de devise inventée.** Sans fournisseur de taux, les montants d'une autre devise sont exclus des totaux et signalés explicitement.
- **Détection déterministe.** Même relevé, même résultat, sans IA et sans appel réseau.
- **IA strictement bornée.** Trois usages, pas un de plus ; sortie validée par Zod avant tout affichage ; contexte réduit à des faits déjà calculés ; aucune mutation possible.
- **Aucun tracker.** Ni SDK publicitaire, ni analytics comportemental, ni identifiant publicitaire.
- **Facturation par les stores uniquement.** Aucune donnée de carte ne transite par l'application. Une résiliation conserve l'accès payant jusqu'à la fin de la période déjà réglée.
- **Secrets côté serveur uniquement.** Aucune variable `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` ne porte de clé. Côté mobile, seules l'URL publique de l'API et les identifiants de produits des boutiques y figurent.
- **Aucune donnée sensible en journal.** Un test structurel lit le code et échoue si un `console.*` interpole un jeton, une empreinte, une clé, une adresse ou un corps de requête.

---

## Sécurité

- Sessions par **token opaque** (32 octets aléatoires), stocké **haché en SHA-256** ; le token brut n'existe qu'une fois, dans la réponse de `register`/`login`, et vit côté mobile dans `expo-secure-store` — jamais en `AsyncStorage`.
- Mots de passe hachés en **Argon2id**, jamais renvoyés ni journalisés.
- Tokens de réinitialisation : aléatoires, hachés, à usage unique, à durée de vie courte.
- Rate limiting par domaine (connexion, inscription, réinitialisation, import, IA, API générale, notifications de stores).
- Un relevé importé est **supprimé immédiatement** après analyse, y compris en cas d'échec.
- Aucune donnée sensible en logs : ni mot de passe, ni token, ni secret de store, ni contenu de réponse IA rejetée.

Détail complet : `specs/auth-comptes-rgpd.md` et `CLAUDE.md` §6.

---

## État d'avancement

Les phases 1 à 8 sont implémentées et testées. Les vérifications restant à faire **hors de cet environnement** sont listées phase par phase dans `CLAUDE.md` §7 — principalement :

- exécution des migrations et du seed sur une base PostgreSQL réelle ;
- tests manuels de l'app sur appareil (4 tailles d'écran, dynamic type, VoiceOver/TalkBack, liens profonds) ;
- bacs à sable Google Play et App Store (les tests substituent un double au client HTTP des stores) ;
- branchement d'un vrai fournisseur d'e-mail transactionnel, d'un provider IA et d'un fournisseur de taux de change ;
- **achat in-app réel** : le parcours est branché (`billing/pricing.tsx` → `expo-iap` → `POST /api/billing/purchase/verify` → `finishTransaction`), mais `expo-iap` est un module natif **absent d'Expo Go**. L'écran d'offres reste consultable dans Expo Go et annonce explicitement que l'achat exige un *development build* (`eas build --profile development`). Aucun repli ne simule un achat.
- **envoi d'un vrai e-mail** : le transport est implémenté et testé, mais aucune clé de fournisseur n'existe ici — un envoi de bout en bout reste à faire ;
- **icônes** : celles du dépôt sont générées par script (`apps/mobile/assets/generate-assets.mjs`), valides mais à remplacer par un travail de graphiste avant soumission.

---

## Licence

Projet privé. Tous droits réservés.
