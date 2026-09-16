# CLAUDE.md — Gestionnaire d'abonnements (source de vérité technique)

Ce fichier est la source de vérité technique du projet **Gestionnaire d'abonnements**. Claude Code doit le lire intégralement avant toute modification, ainsi que le fichier de spec concerné dans `specs/`, avant d'écrire du code. Aucune implémentation ne doit contredire ce document sans qu'une raison technique explicite ne soit consignée dans le code (commentaire + mise à jour de ce fichier si la décision est structurante).

---

## 0. Ce que ce document remplace

Ce projet est la **V1 mobile** de Gestionnaire d'abonnements (anciennement nommé « SaveWise » — voir §1 pour le nommage définitif). Il ne s'agit plus d'une application web SaaS classique : c'est une **application mobile** (Android prioritaire, iOS suivra avec la même base de code) qui importe des relevés bancaires (CSV / PDF) pour détecter des abonnements et dépenses récurrentes, calculer leur coût réel, et proposer des économies. La saisie manuelle de dépenses n'est **plus** un parcours principal : c'est un outil de correction exceptionnel.

Il n'y a **aucune intégration Stripe**. La facturation passe exclusivement par les systèmes d'achat intégré des plateformes (Google Play Billing / Apple StoreKit), qui prennent nativement en charge les cartes Visa et les principaux réseaux de paiement via le compte Google/Apple de l'utilisateur.

---

## 1. Vision produit — V1

> L'application importe un relevé bancaire (CSV ou PDF), détecte les abonnements et dépenses récurrentes, calcule leur coût mensuel/annuel réel, et propose des économies vérifiées.

Principes non négociables de la V1 :

- Parcours principal : **Création de compte (obligatoire) → Import (CSV ou PDF) → Vérification → Détection des récurrences → Dashboard → Recommandations**.
- **Aucun mode invité : l'application n'est utilisable qu'après création d'un compte.** Aucun écran fonctionnel (import, vérification, dashboard, transactions, abonnements, économies, comparaison, paramètres) n'est accessible sans compte créé et session valide — pas d'aperçu ni d'essai avant inscription. Seuls l'écran d'accueil, la sélection de langue et les écrans d'authentification (inscription, connexion, mot de passe oublié) sont accessibles sans session. La création de compte est la dernière étape de l'onboarding, juste avant le tout premier import (voir `specs/ui-composants-mobile.md` §2-3 et `specs/auth-comptes-rgpd.md` §6).
- La saisie manuelle reste disponible uniquement pour : corriger une transaction importée, ajouter une dépense en espèces, ajouter une transaction absente du relevé. Elle n'est **jamais** mise en avant comme fonctionnalité principale et ne doit apparaître dans aucun onboarding comme action recommandée.
- Deux offres uniquement en V1 : **Free** et **Plus**. Pas d'offre Pro, pas de multi-profils/famille, pas de règles personnalisées, pas de connexion bancaire directe (Open Banking), pas de synchronisation automatique.
- Application mobile unique multiplateforme (un seul code source), **Android priorisé pour la publication V1**, iOS packagé avec la même base de code et publié dans un second temps. Pas de développement de deux applications natives séparées.
- Pas de widgets, pas d'Apple Watch, pas de raccourcis Siri / Google Assistant, pas de mode hors-ligne complet, pas d'intégration calendrier, pas de tablette optimisée dédiée en V1.
- **Aucun tracker** : aucun SDK publicitaire, aucun SDK d'analytics comportemental tiers (pas de Firebase Analytics, pas de Meta/Facebook SDK, pas d'AppsFlyer, pas de Mixpanel/Amplitude). Un éventuel outil de crash-report doit être strictement first-party, sans identifiant publicitaire, et documenté dans la politique de confidentialité — il est différé et non requis pour la V1.
- **Nom de produit (décision définitive) :** le projet est renommé « SaveWise » → **Gestionnaire d'abonnements**. Le code, le dépôt et les identifiants techniques (`applicationId` Android, bundle id iOS, nom de package) utilisent un identifiant stable non traduit : `subscription-manager`. Le **nom affiché** sur chaque fiche store (Google Play Console / App Store Connect) est localisé par langue, comme le permettent nativement les deux plateformes : `en` → **Subscription Manager**, `fr` → **Gestionnaire d'abonnements**, `es` → **Gestor de suscripciones**. Dans l'application elle-même, le nom affiché suit la locale active de l'utilisateur (même mécanisme que le reste de l'i18n). Voir `ACTIONS_MANUELLES.md` §1-2 pour la configuration exacte sur chaque store.

---

## 2. Stack & conventions globales

### 2.1 Architecture en monorepo

```
apps/
  api/      → backend (API uniquement + quelques pages publiques légales)
  mobile/   → application mobile (React Native + Expo)
packages/
  shared/   → types, schémas Zod, constantes partagés entre api et mobile
```

Gestion du monorepo : **npm workspaces** (`workspaces: ["apps/*", "packages/*"]`), scripts racine délégant aux workspaces.

### 2.2 `apps/api` — backend

- **Next.js (App Router)**, utilisé uniquement pour : les routes API (`src/app/api/**`) et un minimum de pages publiques statiques nécessaires légalement (politique de confidentialité, CGU, cookies, aide, contact) — pas de site marketing complet, l'app mobile est le produit.
- **TypeScript strict** partout (voir `tsconfig` en §2.6).
- **PostgreSQL** + **Prisma ORM**, `Decimal` obligatoire pour tout montant financier stocké (jamais de `number` JS pour un montant persistant).
- **Zod** pour toute validation d'entrée (body, query, params, réponses de providers externes).
- **next-intl** pour les pages publiques de `apps/api` uniquement (en / fr / es). Configuration : `src/i18n/request.ts`, dictionnaires statiques dans `src/locales/{en,fr,es}.json`, pages sous `src/app/[locale]/`. Les cinq pages (confidentialité, CGU, cookies, aide, contact) sont **prérendues statiquement** dans les trois langues, sans JavaScript applicatif, sans donnée utilisateur et sans cookie.
- Configuration publique des pages légales dans `src/lib/env/client.ts` (`NEXT_PUBLIC_*`). Ce module ne porte **que** des valeurs publiques : Next.js les inline dans le bundle, donc aucun secret n'a le droit d'y figurer.
- ESLint + Prettier, mêmes règles que `apps/mobile` : une **configuration plate unique** à la racine (`eslint.config.mjs`) couvre les trois workspaces avec analyse typée. Le formatage relève de Prettier seul — les deux outils ne se chevauchent pas.
- Architecture stricte : `UI (routes) → Zod → auth/session → Services → Repositories → Prisma → PostgreSQL`. Aucune requête SQL/Prisma directement dans une route handler.

### 2.3 `apps/mobile` — application mobile

- **React Native + Expo** (managed workflow), **Expo Router** pour la navigation par fichiers.
- **NativeWind** (Tailwind CSS pour React Native) — c'est la façon dont l'exigence « Tailwind CSS, 100 % responsive mobile-first » de ce projet est satisfaite sur mobile natif.
- **TypeScript strict**, identique à l'API.
- **TanStack Query** pour tous les appels réseau vers `apps/api` (cache, retry, invalidation).
- **react-hook-form** + résolveur Zod, en réutilisant les schémas de `packages/shared/validation`.
- **i18next / react-i18next** + `expo-localization` pour l'i18n mobile (en / fr / es). Les traductions sont **statiques** (fichiers de traduction), jamais générées par IA à la volée.
- Aucune logique métier critique (calculs financiers, détection de récurrence, matching de comparateur, appels IA) ne doit vivre côté mobile : le mobile affiche des DTO déjà calculés par `apps/api`.
- Aucun accès direct à PostgreSQL, à Prisma, ou à une clé secrète (Stripe n'existe pas ; clé IA, secrets de session, clés stores) depuis le code mobile.

### 2.4 `packages/shared`

- Types TypeScript partagés (DTO d'API, enums métier).
- Schémas Zod partagés (validation identique côté formulaire mobile et côté API).
- Constantes centralisées : langues, pays, devises, plans, codes d'erreur.

### 2.5 Responsive mobile (exigence stricte)

- Aucune dimension en pixels fixes pour la mise en page : flexbox / pourcentages / unités relatives uniquement.
- Gestion des zones sécurisées (encoches, capteurs, barre de gestes) via `react-native-safe-area-context` sur **tous** les écrans.
- Support du **dynamic type** / mise à l'échelle de la police (accessibilité) sans casser les mises en page.
- Testé sur au minimum : un petit écran Android (~360dp de large), un iPhone SE, un grand écran Android, un iPhone Pro Max. Aucun scroll horizontal non intentionnel.
- Orientation portrait uniquement en V1 (le paysage n'est pas un objectif de la V1, mais l'app ne doit jamais planter ou devenir illisible si l'OS force une rotation).
- La tablette n'est pas optimisée en V1 mais la mise en page doit rester utilisable (pas de crash, pas de contenu coupé) — pas d'UI dédiée tablette.

### 2.6 TypeScript strict

Identique dans `apps/api` et `apps/mobile` (adapter `jsx`/`moduleResolution` selon Next.js vs Expo/Metro) :

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  }
}
```

Éviter `any` ; préférer `unknown` + narrowing explicite.

---

## 3. Arborescence

`ARBORESCENCE_INITIALE.md` décrit l'arborescence **de départ**, telle qu'elle devait être créée au premier jour. Elle n'est plus le reflet exact du dépôt : voir `README.md` §Structure pour la vue à jour, et le §10 de ce fichier pour les écarts assumés.

Écarts par rapport au plan initial, tous documentés en §10 :
- ajout de `apps/api/src/lib/{billing,comparison}/`, `apps/api/src/server/{admin,entitlements,import}/`, `apps/api/src/i18n/` ;
- ajout de `apps/api/src/repositories/{expense,savings,store-notification,dashboard,import,recurring,account,auth-session,password-reset-token}.repository.ts` (le plan n'en listait que quatre) ;
- `apps/api/src/locales/` contient trois fichiers JSON, et non trois dossiers ;
- `apps/api/src/server/policies/` et `apps/api/src/server/jobs/` n'ont pas été créés : les politiques vivent dans `entitlements/` et le job d'expiration est exposé par une route d'exploitation (§10.8).

---

## 4. Internationalisation, pays, devises

- Langues supportées : `en` (défaut), `fr`, `es`. Indépendantes du pays et de la devise (ex. `language=fr`, `country=US`, `currency=USD` est un cas valide et doit être testé).
- Devises supportées : `EUR`, `USD`, `GBP`, `CAD`, `AUD`.
- Pays : codes ISO 3166-1 alpha-2 majuscules, liste centralisée dans `packages/shared/constants/countries.ts`.
- Ne jamais déduire automatiquement la devise ou le pays depuis la langue.
- Les préférences (`language`, `country`, `currency`) sont persistées sur `User` en base ; elles constituent la source de vérité pour un utilisateur authentifié (un éventuel cache local sur mobile n'est jamais une source d'autorisation ou de vérité métier).

---

## 5. Règles métier non négociables (V1)

1. **Aucune donnée financière n'est fiable avant validation serveur.** Le mobile ne calcule aucun total, aucune détection, aucun KPI : tout est calculé par `apps/api` et renvoyé sous forme de DTO.
2. **Montants financiers** : stockage en `Decimal(19,4)` (Prisma) ; tout calcul métier pur (`packages/shared` / services financiers) s'effectue en **unités mineures entières (`bigint`, ex. centimes)**, jamais en `number` flottant. La conversion Decimal ↔ bigint minor units se fait uniquement aux frontières (lecture DB / écriture DB / affichage).
3. **Isolation stricte par `userId`** sur toute requête portant sur une ressource privée. Jamais de `findUnique({ where: { id } })` sur une ressource utilisateur sans filtre `userId` déjà vérifié.
4. **Import de relevé (CSV/PDF)** est le parcours principal de création de dépenses. La création manuelle reste possible uniquement comme action secondaire (voir `specs/import-releves.md` et `specs/ui-composants-mobile.md`) et doit systématiquement passer par Zod + `requireUser()`.
5. **Détection des récurrences** est un moteur 100 % déterministe : aucune IA, aucun appel réseau, résultat reproductible à l'identique pour une même entrée (voir `specs/moteur-recurrence.md`).
6. **IA strictement bornée** — en V1, seuls trois usages sont autorisés : (a) un résumé mensuel, (b) une explication simple d'une hausse de dépense, (c) une recommandation basée sur des chiffres déjà calculés par le moteur financier. Tout le reste est explicitement hors-scope V1 : pas de chatbot ouvert, pas de conversation illimitée, pas d'analyse de questions personnelles libres, pas de prédictions financières, pas de conseils personnalisés complexes, pas de catégorisation entièrement pilotée par l'IA, pas de génération de plans financiers, pas de traduction via IA (traductions statiques uniquement). Voir `specs/comparateur-et-assistant-ia.md`.
7. **Paiement** : uniquement via Google Play Billing (Android) et Apple StoreKit (iOS). Aucune intégration Stripe ni passerelle de paiement web tierce. Le paiement par carte Visa (et autres réseaux principaux) est pris en charge nativement par le compte Google/Apple de l'utilisateur — aucune saisie de carte n'est gérée directement par l'application.
8. **Résiliation d'abonnement → accès conservé jusqu'à la fin de la période déjà payée.** Dès réception du signal de résiliation envoyé par le store (auto-renouvellement désactivé), l'abonnement est marqué `cancelAtPeriodEnd = true` mais le plan payant et ses entitlements restent actifs jusqu'à `currentPeriodEnd` (pratique standard — Netflix, Spotify, etc. — pour éviter les avis négatifs et demandes de remboursement liés à une coupure sur une période déjà réglée). Le plan ne repasse à `FREE` qu'à l'expiration effective de la période (notification `SUBSCRIPTION_EXPIRED`/`EXPIRED` du store). Voir `specs/paiement-in-app.md` §6.
9. **Suppression de compte** : autorisée si l'utilisateur n'a **pas** d'abonnement payant (plan `FREE`) **ou** si son abonnement payant a déjà été résilié (`cancelAtPeriodEnd = true`) — même s'il conserve encore l'accès payant jusqu'à la fin de sa période en cours (règle §5.8). Seul un abonnement payant **encore actif et non résilié** bloque la suppression ; l'utilisateur est alors invité à résilier d'abord, ce qui débloque la suppression immédiatement, sans attendre la fin de période.
10. **Comptes e-mail** : l'inscription doit accepter toute adresse e-mail valide au sens RFC (validation Zod `email()`), sans liste blanche restrictive de domaines. Les fournisseurs suivants doivent explicitement être couverts par les tests d'inscription : Gmail, Outlook/Hotmail/Live, ProtonMail/Proton.me, Tuta/Tutanota, Yahoo Mail, Orange (orange.fr / wanadoo.fr), La Poste (laposte.net), ainsi que les adresses consultées via des clients comme Samsung Email ou Thunderbird (ce sont des clients, pas des domaines — aucune règle ne doit filtrer sur le client utilisé). Un éventuel filtre anti-abus de domaines jetables/temporaires ne doit jamais bloquer un des fournisseurs listés ci-dessus.
11. **Pas de tracker.** Aucun SDK d'analytics comportemental ou publicitaire n'est intégré. Voir §1 et `RECAP_FONCTIONNALITES.md`.
12. **Comparateur** : matching déterministe uniquement, base d'offres vérifiées restreinte en V1, jamais de prix inventé.
13. **RGPD** : export JSON complet, suppression irréversible (sous réserve de la règle n°9), minimisation des données, aucune collecte hors nécessité fonctionnelle.
14. **Aucun mode invité : compte obligatoire avant toute fonctionnalité.** L'application n'est utilisable qu'après création d'un compte et obtention d'une session valide — y compris pour le tout premier import. Seuls l'écran d'accueil, la sélection de langue et les écrans d'authentification (inscription, connexion, mot de passe oublié) sont accessibles sans session ; tout le reste (import, vérification, dashboard, transactions, abonnements, économies, comparaison, paramètres) est protégé par navigation ET par `requireUser()` côté API (aucune exception, aucun aperçu avant inscription). Voir `specs/ui-composants-mobile.md` §2-3 et `specs/auth-comptes-rgpd.md` §6.

---

## 6. Sécurité & RGPD (résumé)

- Session par **token opaque côté serveur** (`AuthSession`, hashé en base — même famille que les tokens de reset), transmis par le client via `Authorization: Bearer <token>` et stocké côté mobile dans `expo-secure-store`. Pas de cookie de session : l'API est consommée exclusivement par un client mobile natif, pas par un navigateur.
- Mots de passe hashés Argon2id (ou bcrypt à coût élevé documenté si Argon2id indisponible).
- Tokens de reset : aléatoires cryptographiquement sûrs, stockés hashés, usage unique, expiration courte.
- Rate limiting distinct sur : login, register, reset password, upload CSV/PDF, appels IA, API générale, notifications serveur des stores.
- Aucune donnée sensible dans les logs (mots de passe, tokens, secrets stores, clé IA).
- Détail complet dans `specs/auth-comptes-rgpd.md`.

---

## 7. Plan séquentiel & checklist globale d'avancement

Chaque phase renvoie vers son fichier de spec. **Ne pas passer à la phase suivante tant que les vérifications de la phase courante ne sont pas toutes cochées** (règle de vérifications multiples, voir §7.10).

### Phase 0 — Fondations
- [ ] Monorepo initialisé (`apps/api`, `apps/mobile`, `packages/shared`), workspaces npm fonctionnels.
- [ ] `apps/api` : Next.js App Router, TypeScript strict, ESLint, Prettier, Prisma, PostgreSQL accessible.
- [ ] `apps/mobile` : Expo + Expo Router + NativeWind + TypeScript strict opérationnels sur simulateur Android et iOS.
- [ ] `.env.example` complet, aucun secret réel committé.
- **Vérification** : `npm run typecheck`, `npm run lint`, `npm run format:check` passent sur les deux apps.

### Phase 1 — Schéma de données
Spec : `specs/schema-donnees.md`
- [x] Modèles Prisma créés, migrations versionnées, seed fonctionnel (offres de comparaison de démonstration uniquement, aucune donnée personnelle réelle).
- **Vérification** : `npx prisma migrate dev` + `npx prisma db seed` sans erreur ; relecture manuelle du schéma contre la checklist de `schema-donnees.md`.
  - Fait : `prisma validate`, `prisma format` (schéma inchangé), `prisma generate`, `npm run typecheck`, `npm run format:check`, relecture contre la checklist `schema-donnees.md` §15.
  - **Reste à faire** : `npm run db:migrate:deploy --workspace=apps/api` puis `npm run db:seed --workspace=apps/api

# Cohérence Expo (à repasser après chaque `npm install`)
npx expo-doctor --prefix apps/mobile
npm run doctor --workspace=apps/mobile` sur une base PostgreSQL réelle (nécessite un `DATABASE_URL` valide dans `apps/api/prisma/.env`).

### Phase 2 — Authentification, comptes, RGPD
Spec : `specs/auth-comptes-rgpd.md`
- [x] Inscription (toute adresse e-mail valide), connexion, déconnexion, reset password.
- [x] Export JSON, suppression de compte avec règle de blocage tant qu'un abonnement payant actif n'est pas résilié.
- [x] Aucun mode invité : toute route API en dehors de `/api/auth/*` exige `requireUser()` — vérifié y compris pour le tout premier appel d'import (règle §5.14).
- **Vérification** : tests unitaires + intégration de la spec verts ; test manuel des fournisseurs e-mail listés en §5.10 ; test manuel du blocage de suppression avec abonnement actif ; test manuel qu'un appel direct à une route fonctionnelle sans token valide échoue systématiquement.
  - Fait : 128 tests verts (`npm run test`), couvrant les fournisseurs e-mail de §5.10, le blocage/déblocage de suppression selon l'état d'abonnement, et le rejet de toute route protégée sans token valide (token absent, inconnu, expiré, révoqué, compte supprimé).
  - **Reste à faire** : rejeu manuel du parcours complet contre une base PostgreSQL réelle (les tests utilisent un double Prisma en mémoire — voir §10.2) ; branchement d'un fournisseur d'e-mail transactionnel réel pour la réinitialisation ; tests d'isolation §11 portant sur les dépenses, imports, détections, objectifs et IA, à écrire avec les routes correspondantes (phases 3, 4, 6, 7).

### Phase 3 — Import de relevés (CSV / PDF)
Spec : `specs/import-releves.md`
- [x] Pipeline CSV complet, pipeline PDF avec aperçu et lignes incertaines signalées, rollback par lot.
- **Vérification** : tests de déterminisme du parsing ; test manuel d'un import CSV et d'un import PDF réels, rollback vérifié, suppression du fichier source vérifiée.
  - Fait : 280 tests verts, dont les 6 fichiers de tests exigés par `specs/import-releves.md` §12 ; déterminisme de la normalisation des commerçants et du parsing couvert ; suppression du fichier source vérifiée après succès **et** après échec du traitement ; rollback vérifié (lot du propriétaire uniquement, dépenses hors lot préservées, second rollback refusé).
  - **Reste à faire** : import manuel d'un vrai relevé bancaire CSV et d'un vrai relevé PDF (les tests utilisent des fichiers construits par le code) ; élargissement des alias de commerçants et des heuristiques d'en-têtes au vu de relevés réels.

### Phase 4 — Moteur de détection des récurrences
Spec : `specs/moteur-recurrence.md`
- [x] Fonction pure de détection, scoring de confiance, détection de hausses de prix.
- **Vérification** : tests de déterminisme (même entrée → même sortie, plusieurs exécutions) ; revue manuelle des seuils sur des jeux de données réels.
  - Fait : 338 tests verts, dont les 2 fichiers exigés par `specs/moteur-recurrence.md` §10 ; déterminisme vérifié sur 25 exécutions consécutives et sur l'ordre d'entrée ; non-mutation de l'entrée vérifiée ; exclusions `CANCELLED` et mouvements de sens inverse couvertes ; arbitrage utilisateur (confirm / modify / reject) et non-résurrection d'une détection rejetée couverts.
  - **Reste à faire** : revue manuelle des seuils (fenêtres, règles `IRREGULAR_RECURRING`, seuil de variation à 5 %) sur des relevés bancaires réels.

### Phase 5 — Calculs financiers
Spec : `specs/calculs-financiers.md`
- [x] Totaux, moyennes, annualisation, conversions multi-devises, aucun `number` flottant dans un calcul métier.
- **Vérification** : tests unitaires financiers verts ; revue de code ciblée sur toute occurrence de `number` dans `packages/shared/finance` (doit être nulle).
  - Fait : 414 tests verts, dont les 3 fichiers exigés par `specs/calculs-financiers.md` §9 (`finance`, `multi-currency`, `dashboard`). Revue ciblée effectuée : les seules occurrences de `number` dans `packages/shared/finance` et `apps/api/src/lib/finance` sont des compteurs (`occurrences`), des durées en jours (`elapsedDays`, `intervalDays`), des composantes de date (année, mois, jour) et un retour de comparateur — **aucune ne porte de valeur monétaire**. Les seuls `Number(...)` du dossier portent sur des composantes de date, jamais sur un montant.
  - **Reste à faire** : intégration d'un fournisseur de taux de change (aucune conversion n'est possible tant qu'il n'existe pas — voir §10.5) ; relecture des KPI sur des données réelles.

### Phase 6 — Dashboard & UI mobile
Spec : `specs/ui-composants-mobile.md`
- [x] Écrans d'onboarding, dashboard, transactions, abonnements, économies, paramètres.
- [x] Garde de navigation (root layout Expo Router) : redirige systématiquement vers `(onboarding)`/`(auth)` en l'absence de session valide, pour tout écran hors de ces deux groupes — aucune exception, aucun aperçu avant inscription (règle §5.14).
- **Vérification** : test manuel sur 4 tailles d'écran (§2.5) ; vérification qu'aucun écran ne recalcule un KPI côté client ; test manuel qu'un lien profond (deep link) vers un écran protégé sans session redirige bien vers l'inscription.
  - Fait : les **31 écrans** de `specs/ui-composants-mobile.md` §2 existent (2 layouts en plus) ; `npm run typecheck` passe sur les trois workspaces ; parité des clés i18n vérifiée par test automatisé (`apps/mobile/tests/structure.test.ts`) — 435 clés identiques en `en`/`fr`/`es`, aucune manquante, aucune surnuméraire, aucune vide ; revue ciblée « aucun calcul client » : les seules manipulations de `minorUnits` hors DTO sont le formatage d'affichage, la hauteur des barres du graphique et la **transcription d'un montant saisi** (`lib/money-input.ts`, manipulation de chaîne uniquement), toutes isolées et commentées ; aucune dimension de mise en page en pixels fixes.
  - Fait (correctif de recette) : la garde de navigation rend désormais **toujours** un navigateur — elle ne renvoie plus un `<Redirect>` à la place du `<Stack>` (§10.10) ; sa décision est une fonction pure testée sur 40 cas (`lib/navigation-guard.ts`).
  - **Reste à faire** : **tests manuels sur appareil** — les 4 tailles d'écran de §2.5, le dynamic type, VoiceOver/TalkBack, et le lien profond sans session. Ils exigent un simulateur ou un téléphone : rien de tout cela n'a été exécuté. Aucun test de **rendu** n'existe côté mobile (les 159 tests mobiles portent sur la logique pure : URL d'API, garde de navigation, transcription des montants, corps multipart, descripteurs d'appels, parcours d'achat, vérifications structurelles).

### Phase 7 — Comparateur & assistant IA borné
Spec : `specs/comparateur-et-assistant-ia.md`
- [x] Matching déterministe d'offres, garde-fous IA (3 usages autorisés uniquement), quotas.
- **Vérification** : tests de garde-fous IA verts (aucune sortie hors du schéma Zod n'atteint l'utilisateur) ; relecture manuelle du prompt système.
  - Fait : 509 tests verts (`npm run test`), dont les 8 points de la checklist B.9 et les 8 points de la checklist A.9. Couverts en particulier : provider interchangeable (mock injecté), sérialisation du contexte sans aucun champ interdit, cloisonnement strict par `userId`, rejet **et** journalisation sans contenu d'une sortie hors schéma, non-dépassement du quota sous 20 appels concurrents pour 3 crédits, fonctionnement intégral de l'application avec `AI_PROVIDER=none`, et vérification structurelle qu'aucune quatrième tâche ni quatrième route IA n'existe. Le prompt système de B.6 est repris **au mot près** dans `ai.prompt.ts` et relu.
  - **Reste à faire** : brancher un vrai provider (`AI_PROVIDER=openai` + `AI_API_KEY`) et vérifier le format de sortie réel — les tests n'exercent que le mock ; alimenter la base d'offres de production offre par offre (le seed ne contient que des offres de démonstration, dont les dates de vérification sont figées début 2026 et donc déjà périmées) ; exécuter la migration `20260829130000_comparison_offer_audit` sur une base PostgreSQL réelle.

### Phase 8 — Paiement in-app
Spec : `specs/paiement-in-app.md`
- [x] Achat Plus mensuel/annuel via Play Billing et StoreKit, traitement des notifications serveur des deux stores, entitlements Free/Plus.
- **Vérification** : test en bac à sable (sandbox) sur les deux stores ; vérification que la résiliation conserve l'accès payant jusqu'à `currentPeriodEnd` puis repasse à `FREE` à l'expiration (règle §5.8), et que la suppression de compte se débloque dès la résiliation sans attendre cette expiration (règle §5.9).
  - Fait : 578 tests verts (`npm run test`), couvrant les 8 points de la checklist §10 et les 6 points de la checklist §11. En particulier : achat mensuel **et** annuel vérifiés serveur sur les deux stores ; `SUBSCRIPTION_CANCELED` / `autoRenewStatus:false` ne modifie **que** `cancelAtPeriodEnd` (plan, statut et échéance vérifiés inchangés) ; `SUBSCRIPTION_EXPIRED` / `EXPIRED` et le job de secours sont les seuls chemins vers `FREE` ; parcours complet achat → résiliation → accès encore actif → avance de la date → passage à `FREE` ; notification rejouée traitée une seule fois ; aucune route ne permet à un client de fixer son plan ; suppression bloquée puis débloquée dès la résiliation. Vérification transverse §7.10 repassée (isolation, absence de flottant monétaire, aucun tracker, parité i18n 349/349/349).
  - **Reste à faire** : **le bac à sable des deux stores n'a pas été exercé** — les tests remplacent l'appel HTTP à Google/Apple par un double (`tests/helpers/billing.ts`) ; le code réel des deux clients (`lib/billing/google-play.ts`, `lib/billing/app-store.ts`) n'a jamais atteint un serveur de store. Restent donc à valider avec de vrais identifiants : la signature RS256/ES256 contre les vraies API, le format exact des réponses, la vérification de bout en bout de la chaîne de certificats Apple (`APP_STORE_ROOT_CA` doit être renseigné avec le certificat publié par Apple), et le branchement Pub/Sub côté Google. Le parcours d'achat mobile est désormais branché (`app/billing/pricing.tsx` → `lib/purchase-flow.ts` → `POST /api/billing/purchase/verify`), mais le SDK natif est **absent d'Expo Go** : il n'a donc jamais été exercé contre un vrai store, et l'achat exige un *development build* (§10.10). Reste aussi à planifier `POST /api/billing/expire-overdue` sur la plateforme d'hébergement.

### Phase 9 — Sécurité finale, publication
- [ ] `specs/auth-comptes-rgpd.md` (section sécurité) entièrement revalidée.
- [ ] Dossier Google Play Console préparé (voir `ACTIONS_MANUELLES.md`).
- [x] Mise en état de production (§10.11) : envoi d'e-mail **réel**, magasins partagés entre instances (rate limiting, aperçus d'import), contrôle de configuration bloquant au démarrage, icône/écran de démarrage, versionnage EAS distant, CI GitHub Actions, hygiène des journaux vérifiée par test.
  - **Reste à faire** : renseigner `EMAIL_PROVIDER_API_KEY` / `EMAIL_FROM` avec un domaine vérifié chez le fournisseur et envoyer un e-mail de bout en bout ; exécuter la migration `20260906120000_shared_stores` sur une base réelle et vérifier `ON CONFLICT` et la cascade ; planifier la purge des tables `rate_limit_counters` et `import_previews` ; remplacer les icônes générées par un travail de graphiste ; `eas init` puis un premier build `production` pour valider le versionnage distant.
- [x] Outillage qualité complet : ESLint installé et configuré (`eslint.config.mjs`), `npm run lint` et `npm run build` opérationnels, `README.md` rédigé, plus aucun fichier vide dans le dépôt.
- [x] Pages publiques légales rédigées et prérendues en `en`/`fr`/`es` (confidentialité, CGU, cookies, aide, contact) — exigées par les boutiques et par le RGPD.
- **Vérification finale** : voir checklist complète dans `RECAP_FONCTIONNALITES.md` + repasser l'intégralité des tests (`npm run test`, `npm run test:e2e`) sur les deux apps.

### 7.10 Règle de vérifications transverses (multiples, tout au long du projet)

En plus des vérifications de fin de phase ci-dessus, exécuter après **chaque** phase paire (0, 2, 4, 6, 8) une vérification transverse courte portant sur l'ensemble du projet déjà écrit :
- isolation multi-utilisateur (aucune requête sans filtre `userId`) ;
- absence de `number` flottant dans un calcul financier ;
- absence de tout SDK d'analytics/publicité ajouté par erreur (`no tracker`) ;
- i18n : les nouveaux textes existent bien dans les trois langues ;
- responsive : les nouveaux écrans passent le test des 4 tailles d'écran.

Ne pas considérer une phase comme terminée si une vérification transverse échoue, même si les tests unitaires de la phase elle-même sont verts.

---

## 8. Commandes d'exécution et de validation

```bash
# Installation
npm install

# Backend (apps/api)
npm run dev --workspace=apps/api          # écoute sur la boucle locale
npm run dev:lan --workspace=apps/api      # écoute sur l'interface réseau (téléphone physique)
npm run db:generate --workspace=apps/api
npm run db:migrate --workspace=apps/api
npm run db:seed --workspace=apps/api

# Mobile (apps/mobile)
npm run start --workspace=apps/mobile

# Qualité (sur tous les workspaces, depuis la racine)
npm run typecheck     # tsc --noEmit sur api + mobile + shared
npm run lint          # eslint . (configuration plate unique, analyse typée)
npm run lint:fix      # idem, avec correction automatique
npm run format:check  # prettier --check .
npm run format        # prettier --write .
npm run test          # vitest run (suites de apps/api et de apps/mobile)
npm run build         # next build (apps/api)

# Cibler un seul fichier de test
npm run test --workspace=apps/api -- tests/integration/billing-notifications.test.ts
```

Les deux fichiers d'environnement à créer à partir de `.env.example` :

```bash
cp .env.example apps/api/prisma/.env    # CLI Prisma (generate / migrate / seed)
cp .env.example apps/api/.env.local     # exécution Next.js
```

Séquence CI minimale équivalente :

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

Le projet n'est jamais considéré comme dans un état stable tant que ces commandes ne passent pas.

---

## 9. Autonomie technique accordée

Claude Code est autorisé à adapter l'arborescence ou un détail d'implémentation si une solution plus propre ou plus maintenable est identifiée, **à condition strict que** :
- les fonctionnalités décrites dans `specs/*.md` restent respectées ;
- les règles de sécurité (§6) et les règles métier non négociables (§5) restent respectées ;
- toute déviation structurante par rapport à ce fichier soit documentée (commentaire de code + note dans ce fichier si c'est une décision d'architecture).

Toute ambiguïté entre ce fichier et un fichier de `specs/` se résout en faveur de ce fichier (`CLAUDE.md`) pour les règles transverses, et en faveur du fichier de spec pour le détail d'implémentation de son domaine.

---

## 10. Journal des décisions d'architecture

Décisions structurantes prises en cours d'implémentation, au sens de §9.

### 10.1 Phase 1 — schéma de données

- **`packages/shared` est consommé en TypeScript source, sans étape de build.** Le champ `exports` du package pointe vers les fichiers `.ts` (`.`, `./constants`, `./types`, `./validation`). Motif : Metro (Expo) et le compilateur de `apps/api` transpilent déjà le TypeScript ; un build intermédiaire ajouterait un artefact à synchroniser sans bénéfice. Conséquence : tout consommateur doit transpiler ce package (vérifié avec `tsc` et `tsx`).
- **Les enums Prisma sont dupliqués en tuples `as const` dans `packages/shared/constants/enums.ts`.** Motif : `apps/mobile` ne doit dépendre ni de Prisma ni de `@prisma/client` (§2.3), mais la validation Zod doit être identique des deux côtés. Le schéma Prisma reste la source de vérité : toute modification d'enum doit être répercutée dans ce fichier (rappel en commentaire des deux côtés).
- **Montants transportés en unités mineures sérialisées en chaîne** (`MoneyDto = { minorUnits: string; currency }`). Motif : `bigint` n'est pas sérialisable en JSON, et exposer un flottant contredirait §5.2. La conversion `Decimal` ↔ unités mineures reste confinée aux frontières serveur.
- **Le `.env` lu par la CLI Prisma est `apps/api/prisma/.env`** (et non `apps/api/.env`) : c'est le seul emplacement trouvé automatiquement aussi bien depuis la racine du monorepo (`--schema=apps/api/prisma/schema.prisma`) que depuis `apps/api`. `apps/api/.env.local` reste le fichier d'environnement d'exécution de Next.js. Les deux sont ignorés par git ; `.env.example` documente les deux.
- **Prettier ignore les fichiers Markdown** (`.prettierignore`) : `CLAUDE.md`, `specs/*.md` et les documents de pilotage sont rédigés à la main et font foi ; les reformater automatiquement créerait du bruit.
- **Le seed refuse de s'exécuter avec `NODE_ENV=production`** (contournable par `ALLOW_DEMO_SEED=true`). Motif : les offres du seed sont des données de démonstration ; la base d'offres de production est alimentée manuellement avec des prix réellement vérifiés (§5.12).

### 10.2 Phase 2 — authentification, comptes, RGPD

- **`requireUser(request)` prend la `Request` en paramètre**, là où `specs/auth-comptes-rgpd.md` §1 déclare `requireUser()` sans argument. Motif : lire un contexte global (`next/headers`) rendrait chaque route non testable sans simuler le contexte d'exécution de Next.js. Le comportement décrit par la spec est inchangé ; seule la façon d'accéder à l'en-tête `Authorization` diffère.
- **Argon2id via `@node-rs/argon2`**, et non `argon2` (node-gyp). Motif : binaire précompilé, aucune chaîne de compilation C requise sur les postes de développement ni en CI. La spec §3 prévoyait un repli documenté sur bcrypt « si Argon2id indisponible » : ce repli est donc sans objet, aucun code bcrypt n'existe.
- **Rate limiting en mémoire du process** (`src/lib/security/rate-limit.ts`), avec les domaines de la spec §10. Suffisant pour une instance unique — la configuration V1. Le passage à plusieurs instances impose un compteur partagé (Redis) : seule l'implémentation de `consumeRateLimit` change, jamais ses appelants.
- **Le changement de mot de passe révoque toutes les sessions** de l'utilisateur. Durcissement au-delà de la lettre de la spec §5 : un token de session déjà volé ne doit pas survivre à la reprise en main du compte.
- **La suppression de compte supprime les lignes liées explicitement**, dans une transaction, plutôt que de s'appuyer sur les cascades de la base. État final identique à la cascade décrite en §9 ; l'ordre devient vérifiable en test et l'intention reste lisible.
- **Le libellé d'appareil (`X-Device-Label`) est encodé en pourcent** par le client : un en-tête HTTP ne transporte que de l'ASCII, or les libellés d'appareils contiennent des caractères comme « — ».
- **Les tests utilisent un double Prisma en mémoire** (`apps/api/tests/helpers/prisma-mock.ts`), branché par un alias de `vitest.config.mts`. Motif : exercer le code réel (routes → services → repositories) sans dépendre d'un PostgreSQL disponible, et garantir qu'aucun test ne touche une vraie base. Ce double ne remplace pas une validation contre PostgreSQL : unicité, cascades et types `Decimal` restent à vérifier sur une base réelle.

### 10.3 Phase 3 — import de relevés

- **L'aperçu d'import est conservé en mémoire du process** (`src/server/import/preview-store.ts`), avec une durée de vie courte. Motif : le fichier source est supprimé dès la fin de l'aperçu (spec §3), et la confirmation doit malgré tout revalider à partir de données serveur (spec §2) — or `specs/schema-donnees.md` ne prévoit aucune table pour un aperçu en attente et reste la référence unique du schéma. Même limite que le rate limiting : en multi-instances, il faudra un cache partagé ; seul ce module changera.
- **`ConfirmImportInput` accepte deux champs supplémentaires** par rapport à la spec §10 : `dateOrder` et `corrections`. Motif : sans eux, l'utilisateur ne pourrait ni corriger une interprétation de date ambiguë (§4.6), ni corriger une ligne PDF de faible confiance, alors que le flux §5 prévoit explicitement cette étape. Les valeurs corrigées repassent par la même validation que les valeurs extraites.
- **Le sens d'un mouvement est déduit du fichier entier, pas ligne à ligne** : si le relevé comporte au moins un montant négatif, le signe porte le sens ; sinon toutes les lignes sont des débits. Les colonnes débit/crédit séparées priment toujours. Motif : un relevé de dépenses en montants positifs serait autrement entièrement classé en crédits, donc entièrement ignoré.
- **Un crédit non rapproché est marqué `SKIPPED`, sans code d'erreur.** La liste des codes de la spec §7 est fermée et n'en prévoit pas ; un crédit n'est ni une erreur ni un remboursement, simplement une opération qui n'est pas une dépense (§6).
- **Un doublon `HIGH` n'est jamais inséré, même explicitement accepté par le client** ; un doublon `MEDIUM` ne l'est que s'il figure dans `acceptedRows`. La décision reste serveur (§8).
- **Extraction PDF via `unpdf`**, isolée derrière `src/lib/pdf/extract.ts`. Un PDF chiffré, corrompu ou scanné sans couche texte produit `IMPORT_FILE_INVALID` — jamais un résultat partiel silencieux.
- **`src/server/entitlements/entitlements.ts` est créé en avance de phase**, avec l'interface `Entitlements` de `specs/paiement-in-app.md` §7. Motif : le pipeline d'import ne peut pas appliquer la règle « PDF réservé à Plus, essai limité en Free » (§5) sans elle. La phase 8 en reste propriétaire et l'étendra ; seuls les droits d'import sont réellement appliqués aujourd'hui.
- **`IMPORT_TEMP_DIR` rend le répertoire de travail configurable**, et la variable est relue à chaque appel. Motif : permettre un volume dédié en production et cloisonner les fichiers de test qui s'exécutent en parallèle.

### 10.4 Phase 4 — moteur de détection des récurrences

- **`detectRecurrence` vit dans `src/lib/recurring/detect.ts`.** La spec §1 énumère les modules de calcul sans désigner de fichier pour la fonction d'assemblage, et §7 exige qu'elle soit pure : elle ne peut donc pas vivre dans le service, qui interroge la base.
- **Une nouvelle détection est écrite avec le statut `CONFIRMED`.** `DetectionStatus` ne comporte pas d'état « proposé » (`specs/schema-donnees.md` §6 fixe l'enum à CONFIRMED / MODIFIED / REJECTED, et ce fichier est la référence unique du schéma). La proposition reste rejetable à tout moment, ce qui satisfait §8 ; une exécution ultérieure du moteur ne ressuscite jamais une détection rejetée et ne réécrit jamais une fréquence corrigée par l'utilisateur.
- **Les séries sont regroupées par commerçant ET par devise.** Deux paiements du même commerçant dans deux devises différentes n'ont pas de montants comparables : les regrouper produirait une variance et une hausse de prix dénuées de sens.
- **L'intervalle retenu est la médiane, pas la moyenne** (arrondie à l'entier inférieur pour un nombre pair d'intervalles). Une occurrence isolée très décalée ne doit pas déplacer la période observée. La règle est fixe, donc reproductible.
- **`IRREGULAR_RECURRING` est volontairement restrictif** : au moins 4 occurrences, 90 jours d'historique, aucun intervalle au-delà de 120 jours, et tous les intervalles entre la moitié et le double de la médiane. La spec §4 demande une classification conservatrice ; ces seuils sont centralisés dans `IRREGULAR_RULES`.
- **Le critère « commerçant stable » (+30) est refusé à un libellé non identifiant** (vide, purement numérique). Sans cela le critère serait acquis d'office et n'apporterait rien au score.
- **Aucune division dans les comparaisons de montants** : la variation relative est comparée à son seuil par produit en croix sur des `bigint`, et le pourcentage de hausse est calculé en entiers avec un arrondi explicite. Aucune division par zéro n'est possible (§10).
- **La détection est rejouée après chaque confirmation d'import**, au mieux : un échec du moteur est journalisé (nom de l'erreur seul) et ne fait jamais échouer un import déjà enregistré. C'est l'enchaînement du parcours principal décrit en §1 de ce fichier.
- **Le double Prisma des tests reproduit désormais les valeurs par défaut du schéma** (`status`, `frequency`, `category`, `source`…). Sans elles, une écriture qui s'appuie sur un défaut de la base se comportait différemment en test et en production.

### 10.5 Phase 5 — calculs financiers et tableau de bord

- **Le noyau de calcul vit dans `packages/shared/finance`**, conformément à la spec §1, et `apps/api/src/lib/finance/*` en est la couche métier (totaux sur des lignes de dépenses, projections de dates, agrégation). `apps/api/src/lib/finance/money.ts` ne fait plus que la conversion aux frontières `Decimal ↔ bigint ↔ MoneyDto` ; il conserve les noms historiques utilisés par les phases 3 et 4.
- **`Money` (bigint) pour le calcul, `MoneyDto` (chaîne) pour le transport.** `bigint` n'est pas sérialisable en JSON : la conversion se fait au dernier moment, dans le DTO. C'est la même frontière que celle décrite en §1 de la spec.
- **Aucune conversion de devise n'existe.** Faute de fournisseur de taux en V1, le moteur ne totalise que la devise de l'utilisateur ; les dépenses libellées autrement sont **écartées et signalées** dans `DashboardData.unconvertedCurrencies` — un champ ajouté au DTO de la spec §8, sans lequel l'utilisateur verrait des totaux muets et incomplets. Additionner deux devises lève une `CurrencyMismatchError` plutôt que de produire un nombre faux.
- **Arrondi : division entière « half away from zero »**, appliquée uniquement au dernier stade (division, multiplication par un facteur, pourcentage). Aucune ligne n'est arrondie avant d'être sommée (§1). La règle est fixe, donc reproductible.
- **`savings.confirmed` provient des objectifs d'épargne.** Le schéma ne comporte aucune table `Saving` (la structure de la spec §6 n'a pas d'équivalent persistant) : le montant confirmé est donc celui que l'utilisateur a lui-même déclaré atteint. Potentiel et confirmé restent strictement distincts.
- **`savings.potential` compare les abonnements aux offres encore vérifiées**, par égalité stricte du nom de service normalisé, à devise et pays identiques. Une offre dont `nextCheckAt` est dépassée est exclue : elle n'est plus une offre vérifiée (§5.12). Le rapprochement complet relève de `specs/comparateur-et-assistant-ia.md` et remplacera ce filtre strict.
- **Les alertes de hausse de prix sont réservées à l'offre Plus** (`priceIncreaseAlerts`), contrôle serveur. Elles ne s'appuient que sur les hausses **confirmées** par le moteur déterministe de la phase 4.
- **`dashboardService.build(user, now)` reçoit son instant de référence en paramètre** : aucun KPI ne dépend d'une horloge implicite, ce qui rend les fixtures de test stables dans le temps.
- **`IRREGULAR_RECURRING` est exclu du coût annuel récurrent** : il n'a pas de facteur d'annualisation fixe et la spec §4 interdit la fausse précision. `annualizeIrregular` existe pour l'extrapoler explicitement quand l'historique le permet (≥ 90 jours et ≥ 4 occurrences).

### 10.6 Phase 6 — application mobile

- **`legal` s'ajoute aux groupes publics de la garde de navigation.** La spec §3.1 ne cite que `(onboarding)` et `(auth)`, mais l'écran de consentement doit permettre de lire la politique de confidentialité **avant** la création de compte, et les boutiques exigent qu'elle soit accessible. Ces écrans sont du contenu statique traduit : ils n'affichent aucune donnée utilisateur et n'appellent aucune route protégée. Tous les autres écrans restent inaccessibles sans session, y compris par lien profond.
- **Trois routes de lecture ont été ajoutées à `apps/api`** : `GET /api/expenses`, `GET /api/recurring` et `GET /api/savings`. Sans elles, trois onglets sur cinq n'avaient aucune source de données. Elles sont en lecture seule, filtrées par `userId`, et ne contiennent aucun calcul : `RecurringSummaryDto` (coût annuel, prochaine échéance, variation de prix) est produit par le moteur financier côté serveur.
- **Le mobile ne convertit jamais un montant.** `lib/money.ts` est le seul fichier autorisé à passer d'unités mineures à une chaîne affichable, et il le documente : la conversion en `number` n'y sert qu'à appeler `Intl.NumberFormat` sur une valeur déjà arrêtée par le serveur. Aucune addition, soustraction ni comparaison monétaire n'existe côté mobile.
- **Les hauteurs de barres du graphique sont calculées en `bigint`**, puis converties en pourcentage entier. C'est un calcul de mise en page, pas un calcul financier : aucun montant affiché n'en dérive.
- **Aucune information n'est portée par la seule couleur** : statuts, variations et sélections sont toujours doublés d'un texte (« ↑ +12,4 % », « Statut : confirmé », « ✓ »).
- **`app/index.tsx` a été ajouté** comme point d'entrée `/` : Expo Router a besoin d'une route racine, la garde décide ensuite de la destination.
- **Le sélecteur de pays est une recherche, pas une liste de 249 lignes.** Une liste complète serait inutilisable au doigt ; les pays les plus probables sont proposés d'emblée, le reste est atteignable par saisie du code ISO.

### 10.7 Phase 7 — comparateur et assistant IA

- **Une table est ajoutée au schéma : `ComparisonOfferAudit`** (migration `20260829130000_comparison_offer_audit`). `specs/schema-donnees.md` §15 fixe une liste fermée de 11 tables, mais `specs/comparateur-et-assistant-ia.md` A.8 exige que « toute modification d'offre soit auditée (qui, quand, avant/après) » : aucun modèle existant ne peut porter cette trace, et un journal applicatif volatile ne serait pas un audit. La table ne référence pas `User` — la trace doit survivre à la suppression du compte d'un administrateur, donc aucune cascade ne doit pouvoir l'effacer.
- **Le rôle administrateur vient d'une liste blanche d'exploitation (`ADMIN_EMAILS`)**, pas d'une colonne. A.8 impose seulement que le rôle soit « déterminé exclusivement côté serveur » ; le schéma ne prévoit aucun champ de rôle, et le produit n'expose aucune administration. Sans configuration explicite, **personne** n'est administrateur : la vérification échoue toujours du côté fermé.
- **Le matching filtre aussi par devise**, là où le code de A.3 ne filtre que par pays. C'est une conséquence directe de A.2 (« filtrées par pays et devise ») et de `specs/calculs-financiers.md` §7 : comparer un prix en EUR à un prix en USD n'a aucun sens tant qu'aucun fournisseur de taux n'existe.
- **Le tri ne convertit jamais un montant en `number`.** Le code de A.3 propose `Number(a.verifiedPriceMinor - b.verifiedPriceMinor)` ; les `bigint` sont comparés directement, et le tri est complété par le nom de service puis l'identifiant pour être total et reproductible. Le classement ne dépend d'aucun critère lié à une commission.
- **Fraîcheur et expiration sont deux notions distinctes.** `nextCheckAt` dépassée exclut l'offre du matching (A.3) ; une vérification de plus de `COMPARISON_OFFER_MAX_AGE_DAYS` jours la marque `STALE` : elle reste consultable avec son économie calculée, mais `recommendable` vaut `false` et elle n'entre dans aucun total (A.6).
- **« Rafraîchir » ne collecte aucun prix.** `POST /api/comparisons/[expenseId]/refresh` rejoue le matching sur la base d'offres courante. La V1 n'a ni scraping ni API partenaire : la base est alimentée à la main, offre par offre (A.1).
- **`referencedExpenseIds` est vérifié contre un ensemble que le modèle n'a jamais reçu.** Le contexte de B.5 ne transporte aucun identifiant de dépense ; les identifiants ayant servi à bâtir les faits sont conservés côté serveur (`AiFacts.allowedExpenseIds`) et servent uniquement de contrôle. Une référence hors de cet ensemble est donc nécessairement fabriquée, et la réponse entière est rejetée plutôt que nettoyée en silence.
- **Le crédit IA est consommé avant l'appel au provider, sans remboursement.** L'ordre est : provider configuré ? → incrément conditionnel atomique → appel. Un appel réellement passé est consommé même si sa sortie est rejetée ; rembourser ouvrirait une boucle d'appels gratuits en provoquant volontairement l'échec. En revanche, aucun crédit n'est consommé quand l'IA est simplement désactivée (`AI_UNAVAILABLE`).
- **Une sortie rejetée devient un repli statique, pas une erreur.** `degraded: true` et un texte fixe traduit en `en`/`fr`/`es`, versionné avec le code — jamais généré ni traduit par une IA (CLAUDE.md §5.6). L'appel réussit : l'IA est un enrichissement, son absence ne doit pas casser un écran.
- **`parseMinorUnits` accepte les zéros de remplissage de l'échelle de stockage.** `Decimal(19, 4)` représente 13,49 € par « 13.4900 » : refuser cette forme rendait la relecture d'une colonne monétaire dépendante de la normalisation de `Decimal.js`. Un chiffre **significatif** en trop reste refusé — l'arrondir en silence fausserait le total. Correction d'un défaut de la phase 5, révélé par le comparateur.
- **Le double Prisma des tests applique désormais la contrainte de clé primaire** et implémente `$executeRaw` pour les trois énoncés de quota. Sans la contrainte, deux écritures concurrentes créaient deux lignes là où PostgreSQL en refuse une, et le test de concurrence de B.9 passait pour de mauvaises raisons.

### 10.8 Phase 8 — paiement in-app

- **Le client des stores est une interface injectable** (`lib/billing/store-client.ts`), avec deux implémentations HTTP réelles et un double de test. Motif : sans identifiants ni bac à sable, l'appel réseau ne peut pas être exercé ici ; substituer le client plutôt que le service laisse tout le code de vérification, de transition et d'écriture en production dans le chemin testé. Même mécanisme que l'injection du provider IA (§10.7).
- **La notification n'est jamais la source de vérité.** Sauf pour les deux transitions pures de §6 (résiliation, expiration), l'état est **relu auprès de l'API du store** avant écriture. Conséquence directe : une notification forgée ne peut accorder aucun plan, même si le contrôle d'authenticité venait à être contourné.
- **L'idempotence repose sur la clé primaire de `StoreNotificationEvent`**, pas sur un « lire puis écrire ». L'insertion est atomique ; une violation `P2002` signifie « déjà traité ». Deux rejeux concurrents du même événement ne peuvent donc pas être traités deux fois.
- **`effectivePlan()` devient le seul répondant à « Free ou Plus ? »**, et remplace les `subscription?.plan === 'PLUS'` dispersés dans le tableau de bord, l'import et l'IA. Il applique §6 (une résiliation conserve l'accès), §5 (un incident de paiement le suspend) et le filet de secours sur `currentPeriodEnd`. Ce dernier point double le job planifié **à la lecture** : un retard d'exécution du job n'accorde donc jamais d'accès indu.
- **`POST /api/billing/expire-overdue` est ajouté** : §6 prévoit « un job planifié », l'application n'embarque pas d'ordonnanceur. La route est protégée par un secret d'exploitation comparé en temps constant, et injoignable tant que `BILLING_CRON_SECRET` est vide.
- **`GET /api/billing/subscription` est ajouté** : l'écran de facturation du mobile doit afficher l'offre en vigueur sans rien en déduire. La route renvoie le plan **déjà résolu** et les entitlements, jamais les identifiants de transaction du store.
- **Le rôle du serveur s'arrête au refus.** Trois contrôles précèdent toute écriture : le produit doit figurer dans la configuration serveur, le store doit confirmer le **même** produit, et l'achat ne doit pas être déjà rattaché à un autre compte. Ce dernier contrôle ferme le partage d'un même jeton entre deux comptes.
- **Trois requêtes ne sont pas filtrées par `userId`** (`findByStoreReference`, `findByOriginalTransactionId`, `listOverduePaid`). C'est volontaire et documenté : elles ne sont atteignables que depuis les webhooks et le job d'exploitation, jamais depuis une requête authentifiée d'utilisateur. Un test vérifie qu'une notification n'affecte que l'abonnement qu'elle désigne.
- **La vérification de la chaîne Apple épingle la racine.** `APP_STORE_ROOT_CA` doit contenir le certificat publié par Apple ; il n'est jamais fabriqué par nous, et son absence fait échouer toute notification. Le vérificateur est injectable **uniquement** parce que `node:crypto` ne sait pas créer de certificats X.509 : les tests de rejet, eux, exercent bien le vérificateur réel.
- **JWT signés sur `node:crypto` seul**, sans dépendance supplémentaire. Le point délicat est `dsaEncoding: 'ieee-p1363'` pour l'ES256 d'Apple : JOSE attend la concaténation brute `R || S`, alors que Node produit du DER par défaut. Un test vérifie que la signature fait bien 64 octets.
- **`PLANS` n'est lu par aucun service.** C'est une référence de configuration et un repli d'affichage (§3) ; le prix réel vient du store et le plan accordé vient de la vérification d'achat. Un test structurel vérifie qu'aucun fichier de `src/` ne le consomme.

### 10.9 Complétion — documentation, fichiers vides, parcours non branchés

- **`User.tier` n'est plus lu depuis la colonne.** Il est dérivé de l'abonnement par `effectivePlan()` partout où il est projeté (`toAuthenticatedUser`, `toUserDto`), conformément à `specs/schema-donnees.md` §3 (« dérivé exclusivement de `Subscription.plan` »). La colonne reste écrite — resynchronisée dans la **même transaction** que l'abonnement par `subscriptionRepository.save()` — parce que le schéma l'indexe et que l'export RGPD la lit ; mais elle ne fait plus autorité. Conséquence recherchée : une période échue sans notification d'expiration ne peut plus afficher « Plus ».
- **La session charge l'abonnement avec l'utilisateur** (`include: { user: { include: { subscription: true } } }`). Sans cela, dériver le `tier` coûterait une requête supplémentaire sur *chaque* requête authentifiée. Le double Prisma des tests a été étendu pour reproduire les `include` imbriqués.
- **`next-intl` est ajouté aux dépendances de `apps/api`.** CLAUDE.md §2.2 le nommait explicitement, mais il n'avait jamais été installé. Les cinq pages légales sont prérendues en trois langues (15 pages statiques) et ne dépendent d'aucune donnée utilisateur.
- **ESLint est installé et configuré pour de bon.** `eslint.config.mjs` était un fichier vide et `npm run lint` ne faisait rien. La configuration plate couvre les trois workspaces avec analyse typée, et interdit au mobile d'importer Prisma, `lib/db/*`, `lib/env/server*` ou `server/**` — les chemins par lesquels une clé secrète finirait dans le bundle.
- **ESLint n'est pas rejoué par `next build`** (`eslint.ignoreDuringBuilds: true`). Depuis `apps/api`, Next ne verrait qu'une configuration partielle du monorepo ; le lint est une étape à part entière de la CI, sur les trois workspaces à la fois.
- **`POST /api/expenses`, `GET|PATCH|DELETE /api/expenses/[id]` et `POST /api/savings`, `PATCH|DELETE /api/savings/[id]` sont ajoutés.** La saisie manuelle (`specs/ui-composants-mobile.md` §10) et la confirmation d'une économie (§8) n'avaient aucune route : les écrans existaient sans rien pour les servir. Une écriture par ces routes est marquée `MANUAL` **par le serveur** — le client ne peut pas la faire passer pour une ligne importée — et `merchantRaw`/`merchantNormalized` ne sont jamais réécrits : la correction de l'utilisateur vit dans `merchantOverride`.
- **`parseMinorUnits` acceptait déjà les zéros de remplissage** (§10.7) ; un défaut jumeau est corrigé ici : la regex de détection de Stripe du test structurel contenait un caractère de retour arrière littéral à la place de `\b`, ce qui la rendait inopérante. Même cause qu'en §10.4 — une chaîne Python non brute qui avale les séquences d'échappement.
- **`resolveCountry()` remplace une assertion de type dans `toOfferDto`.** `ComparisonOffer.country` est une colonne `String` : elle est revalidée à la frontière comme partout ailleurs, avec repli sur `DEFAULT_COUNTRY`. Une offre au pays illisible ne correspond de toute façon à aucun utilisateur.
- **L'écran de comparaison consomme `GET /api/comparisons/:expenseId`.** Il affichait jusqu'ici « aucune alternative vérifiée » en dur. Il rend maintenant les garanties d'affichage de A.5 : dates de dernière et de prochaine vérification systématiques, lien officiel toujours présent, lien affilié accompagné de sa mention de commission **à côté immédiat**, offre non fraîche marquée obsolète. Aucun montant n'est calculé localement.
- **`(auth)/reset-password.tsx` consomme le lien profond** `subscription-manager://reset-password?token=…` produit par `buildPasswordResetUrl()`. Le token ne fait que transiter : il n'est ni stocké dans le trousseau, ni journalisé. Le succès renvoie vers la connexion, puisque le changement de mot de passe révoque toutes les sessions.
- **`GET /api/billing/subscription` alimente `manage-subscription.tsx`.** L'écran affiche l'offre **déjà résolue** par le serveur et la date de fin de période, sans jamais déduire un droit d'une date.

### 10.10 Correctif de recette mobile — Expo Go, URL d'API, parcours non branchés

Intervention déclenchée par un écran « Something went wrong » au démarrage dans Expo Go.

- **Cause racine du crash : dérive des versions natives.** `apps/mobile/package.json` déclarait ses paquets natifs en plage large (`^`). npm avait donc installé `react-native-reanimated@4.6.0` et, avec lui, `react-native-worklets@0.12.1`, alors qu'Expo SDK 57 — et donc la partie **native** embarquée dans Expo Go — est en `4.5.1` / `0.10.1`. `@expo/ui/src/State/optionalWorklets.ts`, chargé au démarrage par `expo-router`, fait un `require('react-native-worklets')` au niveau module ; l'initialisation du paquet exécute `checkCppVersion()`, qui **lève** en `__DEV__` quand les parties JS et native divergent de version mineure. Metro mémorise l'erreur du module (`module.hasError`) et la **relance à chaque `require` ultérieur**, non capturé cette fois : la barrière d'erreur d'Expo Router affiche alors son écran, dont le titre est littéralement « Something went wrong » (`expo-router/build/views/ErrorBoundary.js`). Correction : toutes les versions natives sont épinglées sur celles du SDK ; `npx expo-doctor` passe de 2 échecs à **21/21**.
- **Les paquets partagés sont épinglés à la racine du monorepo**, pas seulement dans `apps/mobile` : `react`, `react-dom`, `react-native-reanimated`, `react-native-worklets`. Motif : npm hisse une copie unique de ces paquets et, sans dépendance racine, il y place la version la plus permissive demandée par l'outillage d'Expo (`@expo/devtools`, `@expo/ui`, `react-native-drawer-layout` les demandent en `*`). Le champ `overrides` a été essayé d'abord : **npm 11.12.1 l'ignore silencieusement dans ce dépôt** (le champ n'apparaît jamais dans `packages[""]` du lockfile, y compris après suppression du lockfile), y compris pour un paquet neutre servant de témoin. L'épinglage racine, lui, est honoré et vérifiable.
- **`metro.config.js` force les paquets à instance unique.** `resolveRequest` résout `react`, `react-dom`, `react-native`, `react-native-reanimated` et `react-native-worklets` comme s'ils étaient demandés depuis `apps/mobile`, quel que soit le module demandeur. C'est un **filet**, pas la correction : sur l'arbre réparé il ne change rien (vérifié en comparant les cartes de source de deux exports). Il empêche une régression si npm rehisse une version différente. `disableHierarchicalLookup` a été essayé puis écarté : npm imbrique `expo/node_modules/expo-modules-core`, que Metro ne trouverait plus.
- **`app.json` devient `app.config.ts`.** L'URL de l'API doit pouvoir changer sans modifier le code source ; elle est lue depuis `EXPO_PUBLIC_API_BASE_URL` et publiée dans `extra.apiBaseUrl`. La clé est **omise** quand la variable est vide — surtout pas fixée à `http://localhost:3000`, qui gagnait sur toute déduction. Au passage, `newArchEnabled` et `android.edgeToEdgeEnabled`, refusés par le schéma de configuration du SDK 57, sont retirés.
- **`localhost` n'est plus jamais supposé.** `lib/api-config.ts` distingue cinq contextes d'exécution et déduit l'adresse d'un **appareil physique** depuis l'hôte Metro (`hostUri`), qui est par construction l'adresse LAN de la machine de développement. Aucune IP personnelle n'est écrite dans le dépôt. Le serveur doit alors écouter sur l'interface réseau : `npm run dev:api:lan` (`next dev --hostname 0.0.0.0`).
- **Le layout racine rend toujours un navigateur.** Il renvoyait un `<LoadingState/>` puis un `<Redirect/>` **à la place** du `<Stack>` : Expo Router exige qu'un navigateur soit monté dès le premier rendu, et démonter le `<Stack>` pour rediriger produit une navigation morte. La redirection passe maintenant par un effet, et la décision est une fonction pure (`lib/navigation-guard.ts`) testée sur les cas de session absente, valide, expirée, et de lien profond protégé.
- **Une panne réseau n'efface plus la session.** `fetchSession` effaçait le trousseau sur *n'importe quelle* erreur de `GET /api/auth/session` — y compris une API injoignable, c'est-à-dire exactement le symptôme d'un téléphone qui ne trouve pas `localhost`. Seuls les codes par lesquels le serveur déclare la session inutilisable (`AUTH_UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`) effacent désormais le jeton.
- **Diagnostic réseau de développement.** En `__DEV__` uniquement, une requête en échec journalise méthode, URL, code HTTP, famille de panne (DNS / connexion refusée / délai / TLS), plateforme et provenance de l'URL configurée. Jamais d'en-tête, de jeton, de corps ni de donnée utilisateur. En production, le comportement est inchangé.
- **La saisie manuelle est réellement branchée.** « Ajouter une transaction manquante » menait au parcours d'import ; elle ouvre maintenant `app/expense/new.tsx`, et chaque ligne de la liste ouvre `app/expense/[id].tsx` (correction, suppression). Le serveur reste seul à écrire `source = MANUAL`, et `merchantRaw`/`merchantNormalized` ne sont jamais transmis en correction : seul `merchantOverride` l'est. La transcription du montant saisi se fait par manipulation de chaîne (`lib/money-input.ts`), jamais par arithmétique flottante (§5.2).
- **L'économie confirmée a enfin un chemin.** L'onglet Économies était en lecture seule alors que `POST /api/savings` et `PATCH /api/savings/[id]` existaient : il permet maintenant de créer un objectif et de **déclarer** le montant atteint. C'est le seul chemin vers une économie confirmée — le moteur n'en promeut jamais une.
- **L'assistant IA est branché sur ses trois usages, et sur rien d'autre.** `components/ai-assistant.tsx` expose résumé mensuel, explication de hausse et recommandation. Aucune zone de saisie libre, aucun contexte envoyé par le client (les trois requêtes ont un corps vide), aucun appel direct à un fournisseur d'IA. Un test structurel vérifie qu'il n'existe pas de quatrième route.
- **Le SDK d'achat natif est isolé derrière `lib/native-purchases.ts`.** `react-native-purchases` était déclaré et jamais utilisé ; il contient du code natif **absent d'Expo Go**. *(Ce SDK a depuis été remplacé par `expo-iap` — voir §10.11 ; le mécanisme d'isolation, lui, est inchangé.)* Il n'est donc jamais importé statiquement : il est demandé par `require` dans un `try/catch`, et son absence est un **état déclaré** (`NATIVE_MODULE_UNAVAILABLE`) que l'écran d'offres annonce. Il n'existe aucun repli simulant un achat : seule une preuve réellement délivrée par le store part vers `POST /api/billing/purchase/verify`, et c'est le serveur qui accorde le plan.
- **La machine à états de l'import n'a plus d'état inatteignable.** `parsing` et `ready_to_import` étaient déclarés sans jamais être produits, et `rollback_available` était posé *après* une annulation réussie — l'inverse de son sens. `preview`, `validation_error` et `ready_to_import` sont maintenant **dérivés** de l'aperçu et des exclusions (`lib/import-state.ts`, pur et testé). Défaut jumeau corrigé : l'écran d'envoi interpolait le nom d'état dans une clé i18n (`import.states.validation_error`, inexistante) et affichait donc la clé technique ; une table exhaustive `Record<ImportState, string>` rend la dérive impossible à compiler.
- **`apps/mobile` a désormais sa propre suite de tests** (Vitest, 159 tests). Elle porte sur la logique **pure** : résolution d'URL d'API, garde de navigation, transcription des montants, corps multipart, descripteurs d'appels d'API, parcours d'achat, et vérifications structurelles (aucun secret serveur, aucun tracker, aucun Stripe, aucun `fetch` hors du client unique, parité i18n). Elle ne rend aucun composant : `react-native` n'est pas exécutable hors appareil, et un rendu simulé ne prouverait rien de plus sur ces règles. Elle **ne remplace pas** la recette sur appareil.
- **`lib/api-endpoints.ts` sépare le contrat d'API des hooks.** Un hook TanStack Query mêle chemin, méthode, corps, invalidations de cache et cycle de vie React ; les trois premiers relèvent du contrat et se testent sans moteur de rendu. C'est ce qui permet de figer par test qu'aucune requête ne transporte `source`, `plan`, `status` ni `currentPeriodEnd`.

### 10.11 Mise en état de production — envoi réel, magasins partagés, CI

Intervention menée avant toute configuration de boutique. Elle traite ce qui aurait échoué **en production seulement**, c'est-à-dire trop tard.

- **Le transport e-mail « réel » n'envoyait rien.** `httpMailer` journalisait « E-mail réel envoyé à … » — avec l'adresse de l'utilisateur — et retournait. Pire, il était injoignable : `EMAIL_PROVIDER` n'acceptait que `noop` et `console`, alors que le code comparait à `http` et `resend`. Un mot de passe oublié était donc **définitivement sans réponse**. Le transport `resend` fait maintenant un vrai `POST /emails` authentifié, avec délai maximal, gabarits statiques en `en`/`fr`/`es` (CLAUDE.md §5.6) et échappement du lien dans le HTML. `fetch` est injectable : les tests exercent le transport réel sans jamais atteindre un fournisseur.
- **Un échec d'envoi ne doit pas révéler l'existence d'un compte.** `requestPasswordReset` n'appelle le transport que si le compte existe : une erreur remontée aurait fait du code HTTP un oracle d'énumération (200 = inconnu, 500 = connu). L'échec est désormais absorbé, journalisé par le seul **nom** de l'erreur, et la réponse publique reste rigoureusement identique. Deux tests figent l'égalité des deux réponses.
- **`RATE_LIMIT_STORE` et `IMPORT_PREVIEW_STORE` remplacent deux `Map` de process.** Les deux limites étaient documentées depuis les phases 2 et 3 ; elles sont levées. Le rate limiting utilise un `INSERT … ON CONFLICT DO UPDATE … RETURNING` — **un seul énoncé**, donc le point d'atomicité : une lecture suivie d'une écriture laisserait passer le double de la limite sous charge. L'aperçu d'import est une ligne `import_previews` avec TTL, propriétaire et consommation unique.
- **L'aperçu est réservé *avant* l'écriture du lot, plus après.** `consumePreview()` était appelé en fin de `confirm()` : deux confirmations concurrentes du même import passaient toutes deux la lecture et créaient deux lots. La réservation est maintenant la première chose faite après avoir trouvé l'aperçu, et c'est un `updateMany` conditionné sur `consumed_at IS NULL` — seul l'appel gagnant continue.
- **Deux tables techniques s'ajoutent** (`rate_limit_counters`, `import_previews`, migration `20260906120000_shared_stores`), hors de la liste fermée de `specs/schema-donnees.md` §15, pour la même raison qu'en §10.7 : aucun modèle existant ne peut porter un état qui doit être **commun à toutes les instances**. `import_previews` référence `User` (cascade : les aperçus d'un compte supprimé disparaissent avec lui) ; `rate_limit_counters` ne référence rien — sa clé est opaque et le compteur doit survivre à la suppression d'un compte le temps de sa fenêtre.
- **`enforceRateLimit()` devient asynchrone**, et ses 36 appelants avec elle. C'est la conséquence mécanique d'un compteur partagé : le décompte est un aller-retour vers la base. Aucun appelant ne change de comportement.
- **Le rate limiting échoue *ouvert*, l'autorisation échoue *fermée*.** Si le compteur partagé est injoignable, la requête passe et l'incident est journalisé sans identifiant. C'est un arbitrage explicite : le rate limiting protège d'un abus, pas d'un accès non autorisé — et rendre l'API totalement indisponible sur un incident de base serait un dégât plus grand que l'abus qu'on prévient.
- **`src/instrumentation.ts` refuse de démarrer** si, en production, un magasin est resté en mémoire ou l'e-mail n'est pas configuré. Le contrôle ne renvoie que des **noms de variables** et des explications fixes, jamais une valeur. Échouer au démarrage est délibéré : les trois pannes évitées (rate limiting inopérant, imports perdus entre instances, réinitialisation muette) sont invisibles jusqu'à ce qu'un utilisateur les subisse.
- **RevenueCat est retiré au profit de `expo-iap`.** `react-native-purchases` était déclaré sans être utilisé, et il n'a jamais eu sa place : c'est un **back-office de facturation complet** — abonnements, entitlements, webhooks — alors que `apps/api` vérifie déjà les achats **directement** auprès de Google Play Developer API et App Store Server API (`lib/billing/*`). Le garder aurait signifié deux sources de vérité pour l'abonnement, un service tiers payant dans le chemin de facturation, et une clé publique supplémentaire dans le bundle. Aucune spec ne le mentionne : `specs/paiement-in-app.md` §4 dit « SDK natif du store (Google Play Billing Library / StoreKit 2) », ce que `expo-iap` est exactement.
- **Le parcours d'achat devient événementiel, et acquitte après vérification.** `requestPurchase()` ne résout pas avec la transaction : la preuve arrive par `purchaseUpdatedListener`. Et `finishTransaction()` n'est appelé qu'après que le serveur a accordé le plan — un achat Android non acquitté sous **3 jours est remboursé automatiquement** par Google, une transaction iOS non terminée est rejouée à chaque lancement. L'ancien flux ne faisait ni l'un ni l'autre.
- **Il n'y a plus aucune clé publique d'achat.** La facturation directe n'en a pas : seuls les identifiants de produits — visibles sur la fiche du store — passent par `EXPO_PUBLIC_*`, et le serveur refuse tout produit absent de sa propre configuration.
- **Icône, icône adaptative et écran de démarrage existent enfin** (`apps/mobile/assets/`), produits par un script Node versionné (`assets/generate-assets.mjs`, encodeur PNG sans dépendance). Ce sont de **vrais** fichiers valides, pas des placeholders vides — un anneau ouvert évoquant la récurrence, sur le bleu de marque du thème. Ils restent à remplacer par un travail de graphiste avant soumission.
- **EAS passe en versionnage distant.** `cli.appVersionSource: "remote"` et `autoIncrement` sur le profil `production` : `versionCode` et `buildNumber` sont gérés par EAS, et n'apparaissent nulle part dans `app.config.ts`. Deux sources de vérité pour un numéro de build finissent toujours par une soumission refusée pour version déjà utilisée. Les trois profils héritent d'une base commune (`node`) et portent un `channel`. *(Le profil `base` portait aussi `env` ; retiré en §10.12 — une URL d'API figée y cassait le build de développement.)*
- **La version affichée vient de la configuration Expo.** L'écran Paramètres codait `'0.1.0'` en dur ; il lit maintenant `Constants.expoConfig.version` (`lib/app-info.ts`).
- **Une CI GitHub Actions exécute la séquence documentée** (`.github/workflows/ci.yml`), en deux tâches : qualité (typecheck, lint, format, tests, build, `npm ci`, `prisma generate|validate`) et cohérence Expo (`expo-doctor`, `expo install --check`, export du bundle Android). La seconde est ce qui empêche une dérive de version native de repasser en douce (§10.10).
- **Un test structurel garde l'hygiène des journaux** (`tests/unit/log-hygiene.test.ts`) : il lit le code réel et échoue si un `console.*` interpole un jeton, une empreinte, une clé, une adresse ou un corps de requête. Il vérifie aussi que le lien de réinitialisation n'est journalisé que par le transport `console`, lui-même interdit en production.

### 10.12 Correctif de recette Android — build de développement qui ne démarrait pas

Intervention déclenchée par un APK `--profile development` qui se figeait sur l'écran de démarrage puis déclenchait un ANR (« L'application ne répond pas »), sans jamais afficher d'écran permettant de rejoindre Metro.

- **Cause racine : `expo-dev-client` était déclaré dans le `package.json` de la racine du monorepo, jamais dans celui de `apps/mobile`.** L'autolinking d'Expo part des **dépendances du projet Expo**, pas du contenu de `node_modules` : le paquet était bien installé et hissé à la racine, mais absent du graphe de dépendances de l'application. Vérifié par `npx expo-modules-autolinking search -p android` : **24 modules avant, aucun `expo-dev-client` / `expo-dev-launcher` / `expo-dev-menu` ; 29 modules après**, les trois présents. L'APK livré ne contenait donc aucun lanceur de développement. Or `developmentClient: true` construit la variante *debug*, qui **n'embarque aucun bundle JavaScript** : sans lanceur, l'application n'avait ni bundle local, ni écran pour en désigner un — d'où le blocage du fil principal et l'ANR, avant même qu'un QR code puisse être scanné.
- **Le dossier `apps/mobile/android/` a été retiré du dépôt.** Sa présence fait sauter `expo prebuild` côté EAS : le projet natif se fige à la date du dernier prebuild local (ici 17 h 31, alors qu'`app.config.ts` a été modifié à 19 h 50 le même jour) et toute modification ultérieure de la configuration est silencieusement ignorée. C'est aussi ce qui a gravé l'omission ci-dessus dans le binaire : un prebuild exécuté au moment du build, sur le `package.json` corrigé, aurait lié le lanceur. Le projet revient donc au fonctionnement décrit en §2.3 — **CNG**, projet natif régénéré à chaque build — et `android/` / `ios/` sont ignorés par git. Aucun fichier natif n'avait été modifié à la main (`MainActivity`, `MainApplication`, `proguard-rules.pro` étaient les gabarits d'origine) : rien n'est perdu.
- **Le profil `development` d'`eas.json` ne fixe plus `EXPO_PUBLIC_API_BASE_URL`.** Elle était héritée du profil `base` avec la valeur de remplacement `https://api.example.com`. Or cette variable **gagne sur toute déduction** (`lib/api-config.ts`, §10.10) : le build de développement aurait visé un domaine réservé RFC 2606 au lieu de la machine de l'hôte Metro. La valeur de remplacement ne subsiste que sur `preview` et `production`, où elle **doit** être remplacée par l'URL réelle avant tout build distribué.
- **`runtimeVersion` devient une politique unique, commune aux deux plateformes.** Android portait `'1.0.0'` en dur, iOS la politique `appVersion` (donc `'0.1.0'`) : deux binaires qui ne peuvent jamais recevoir la même mise à jour EAS, sans qu'aucune erreur ne le signale. Aucune mise à jour n'ayant encore été publiée, le changement n'invalide rien.
- **Cinq vérifications structurelles gardent la régression** (`tests/structure.test.ts`) : `expo-dev-client` déclaré par l'application, absence de `android/` et `ios/`, absence d'`EXPO_PUBLIC_API_BASE_URL` dans la chaîne `extends` du profil `development`, absence d'adresse de boucle locale dans la configuration Expo, et unicité de la politique `runtimeVersion`. Elles ont été vérifiées **par l'échec** : recréer un dossier `android/` fait bien échouer la deuxième.

### 10.13 Correctif de recette — envoi du relevé en échec sur appareil physique

Intervention déclenchée par un import PDF qui échouait instantanément (« Pas de connexion »), avec `cause réseau : UNREACHABLE` et un terminal d'API resté **muet** : la requête ne partait jamais.

- **L'adresse et le trafic en clair étaient hors de cause, et démontrés tels.** Le client de développement télécharge son bundle JavaScript depuis Metro en **HTTP simple** sur la même machine : si le trafic en clair était interdit (`android:usesCleartextTraffic`), l'application ne démarrerait pas du tout. Et l'écran d'import n'est atteignable qu'avec une session valide (`lib/navigation-guard.ts`, CLAUDE.md §5.14), donc `POST /api/auth/*` puis `GET /api/auth/session` avaient déjà abouti sur `http://<IP LAN>:3000`. Aucune directive de sécurité réseau n'a donc été ajoutée : elle n'aurait rien corrigé, et l'ajouter par `expo-build-properties` aurait aussi ouvert le trafic en clair aux builds `preview` et `production`, qui parlent HTTPS.
- **`UNREACHABLE` ne voulait rien dire.** `classifyNetworkFailure` classait le message de `fetch` ; or le `fetch` de React Native (`whatwg-fetch`) rejette avec `TypeError: Network request failed` **quelle que soit** la panne native. Les branches DNS, connexion refusée et TLS étaient donc inatteignables sur ce chemin, et `UNREACHABLE` n'était pas un diagnostic mais un défaut de classement. Le commentaire de la fonction le dit désormais explicitement, pour que personne n'en tire à nouveau une conclusion.
- **Seul l'envoi multipart échouait, et c'est le seul appel qui empruntait le chemin `FormData` de React Native.** Ce chemin construit le corps **avant** d'ouvrir la moindre connexion (`NetworkingModule.constructMultipartBody`) : un fichier illisible ou un type MIME non analysable interrompt la requête par un `return`, sans qu'aucun octet ne parte — ce qui produit exactement les trois symptômes observés (échec instantané, serveur muet, message inexploitable). Le corps y est de plus adossé à un `InputStream` dont la longueur est déduite d'`available()`.
- **`apiUpload` passe donc par `expo-file-system`** (`File.upload`, `UploadType.MULTIPART`) : corps adossé à un **fichier**, longueur exacte, aucun flux relu — et surtout **l'erreur native remonte telle quelle** au JavaScript. Un échec résiduel est désormais nommé (« cleartext… », « Failed to connect to… », fichier absent) au lieu d'être un `NETWORK_ERROR` muet. Le module était déjà lié à l'application (17ᵉ des 29 modules autolinkés) : **aucun nouveau build natif n'est nécessaire**.
- **Le fichier est recopié sous un nom correct avant l'envoi.** Le contrôle serveur (`resolveSourceType`) déduit CSV ou PDF de l'**extension** avant de vérifier le contenu ; or la copie déposée par `expo-document-picker` s'appelle `<uuid>pdf`, sans point — le serveur y lit « aucune extension » et aurait rejeté le fichier, l'envoi natif ne permettant pas de choisir le nom transmis autrement que par le nom sur disque. `importUploadFileName` reconstruit donc ce nom à partir de la nature **choisie par l'utilisateur** (et non devinée du type MIME : des fournisseurs Android annoncent `application/octet-stream` pour un PDF valide), replie les accents sur l'ASCII et interdit tout séparateur de chemin. La copie est supprimée après l'envoi : un relevé bancaire n'a pas à séjourner dans le cache (§6).
- **Une erreur de lecture locale n'est plus annoncée comme une panne réseau.** Un fichier disparu ou illisible lève `IMPORT_FILE_INVALID` — message déjà traduit dans les trois langues — au lieu d'envoyer l'utilisateur vérifier son Wi-Fi. Le message natif journalisé passe par `redactDiagnosticDetail`, qui masque chemins et URI de fichiers : le nom d'un relevé est une donnée personnelle (§6).
- **`expo-file-system` est déclaré dans `apps/mobile/package.json`**, et non seulement hissé dans `node_modules` — c'est la règle de §10.12, dont un test structurel garde désormais l'application aux trois modules natifs consommés. Le verrou (`package-lock.json`) a été resynchronisé : sans cela, `npm ci` — utilisé par EAS Build **et** par la CI — aurait échoué.

### 10.14 Déploiement Vercel — magasins partagés par défaut en production

Intervention déclenchée par un premier déploiement Vercel refusé au démarrage : « Configuration de production incomplète : IMPORT_PREVIEW_STORE, RATE_LIMIT_STORE ».

- **Le contrôle avait raison, le défaut avait tort.** `IMPORT_PREVIEW_STORE` et `RATE_LIMIT_STORE` valaient `memory` par défaut, une valeur que le contrôle de démarrage refuse en production (§10.11). Un déploiement devait donc déclarer deux variables dont **une seule valeur** est acceptable, et celui qui les oubliait ne démarrait pas. Le défaut suit désormais l'environnement (`defaultSharedStore`, `src/lib/env/server.ts`) : `postgres` en production, `memory` ailleurs.
- **Le contrôle n'a pas été assoupli, et aucun contournement n'a été ajouté.** Sur Vercel, chaque requête peut atteindre une instance différente et une instance peut disparaître entre deux requêtes : en mémoire, la confirmation d'un import ne retrouverait pas son aperçu — le parcours principal (§1) échouerait par intermittence — et le rate limiting ne compterait presque rien. Autoriser `memory` en production aurait fait démarrer un serveur qui ne fonctionne pas. Une valeur `memory` **explicite** reste donc refusée ; le message indique maintenant comment corriger.
- **Une valeur explicite n'est jamais remplacée.** Le défaut ne s'applique qu'à une variable absente : aucune configuration existante ne change de comportement, et les tests (`NODE_ENV=test`) restent en mémoire, sans base.
- **`.env.example` ne fixe plus `memory`.** Recopié tel quel chez un hébergeur, il suffisait à bloquer le démarrage. Les deux lignes sont commentées et documentent le défaut.
- **Prérequis inchangé** : `postgres` exige la migration `20260906120000_shared_stores` sur la base de production (`npm run db:migrate:deploy --workspace=apps/api`). Sans elle, le rate limiting échoue ouvert (journalisé) et l'aperçu d'import échoue.

### 10.15 E-mail de réinitialisation affiché en développement

- **Le transport `console` affiche l'e-mail complet**, et plus seulement une ligne : objet et texte dans la langue du compte, validité, puis le lien et le jeton **chacun seul sur sa ligne**, pour être copiés sans retouche (`formatDevEmailPreview`, `src/lib/mail/mailer.ts`). Le contenu vient du même gabarit que l'envoi réel : ce qui s'affiche est ce qui serait parti.
- **`noop` affiche aussi l'e-mail sous `next dev`.** C'est la valeur par défaut : sans cela, un parcours « mot de passe oublié » local n'aboutissait jamais, le lien n'existant nulle part. Hors développement, `noop` reste silencieux (les tests ne produisent aucune sortie) ; en production, il est refusé au démarrage comme avant (§10.11).
- **La règle de §6 est tenue au plus près.** Le transport `console` reste le seul endroit où le lien est journalisé — le test d'hygiène des journaux le vérifie toujours — et il reste interdit en production. L'adresse du destinataire y est **masquée** (`a***@gmail.com`) : assez pour reconnaître le compte de test, sans recopier une donnée personnelle dans un terminal.
- **Une demande sans compte est signalée, en développement seulement.** Constaté en recette : un téléphone demandait la réinitialisation d'une adresse absente de la base de l'API locale (qui ne contenait qu'un compte). Le service s'arrêtait avant le transport, le terminal n'affichait qu'un `200`, et rien ne permettait de comprendre pourquoi l'aperçu manquait. `reportPasswordResetWithoutAccount` écrit désormais une ligne, adresse masquée, sous `next dev` uniquement : la réponse publique reste identique (§5), et aucun journal de production ne distingue une adresse connue d'une inconnue.

### 10.16 Assistant IA désactivé par défaut

- **L'IA fait partie de la V1, mais elle est livrée coupée.** §5.6 et `specs/comparateur-et-assistant-ia.md` partie B autorisent trois usages bornés ; aucun document n'exige de les activer, et la spec les définit comme un enrichissement, jamais un prérequis (B.3). Tant qu'aucun fournisseur n'est choisi (`ACTIONS_MANUELLES.md` §6), `AI_PROVIDER` vaut `none` — c'est la valeur par défaut du schéma d'environnement et de `.env.example`, et aucune configuration du dépôt (CI, EAS) ne la change. `openai` sans clé équivaut à `none`.
- **`GET /api/ai/summary` indique la disponibilité (`enabled`).** Sans elle, le tableau de bord proposait trois boutons et un compteur de crédits alors que chaque appel répondait `AI_UNAVAILABLE`. La carte n'affiche plus qu'un avis traduit quand l'IA est coupée. Le champ n'est qu'une indication d'affichage : le refus reste appliqué par le service, sans consommer de crédit. Une API antérieure, qui ne renvoie pas le champ, est traitée comme « disponible » par le mobile — le serveur refuse alors l'appel, comme avant.
- **`mock` est ignoré en production.** C'est un double de test : ses phrases fabriquées ne doivent jamais être présentées à un utilisateur réel. L'IA est alors simplement désactivée, **sans** bloquer le démarrage — contrairement au transport e-mail (§10.11), elle n'est pas nécessaire au fonctionnement.
