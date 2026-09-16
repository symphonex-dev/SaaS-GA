# specs/ui-composants-mobile.md — Écrans, composants UI, i18n, accessibilité, responsive

Niveau : intégration standard (composants, navigation, contenu). Aucune logique métier ou calcul financier ne doit être écrit dans un composant — tout DTO affiché provient de `apps/api`.

---

## 1. Stack UI

- **Expo Router** (navigation par fichiers) dans `apps/mobile/app/`.
- **NativeWind** (Tailwind pour React Native) pour tout le style — pas de `StyleSheet` ad hoc dispersé si une classe utilitaire existe déjà.
- **react-hook-form** + résolveur Zod (`packages/shared/validation`) pour tous les formulaires.
- **TanStack Query** pour tous les appels réseau (jamais de `fetch` brut dans un composant sans passer par un hook dédié).
- **i18next / react-i18next** + `expo-localization`, fichiers de traduction statiques `en.json` / `fr.json` / `es.json` par domaine fonctionnel.

---

## 2. Arborescence des écrans (Expo Router)

```
apps/mobile/app/
├── (onboarding)/
│   ├── welcome.tsx
│   └── language-country-currency.tsx
├── (auth)/
│   ├── register.tsx              (dernière étape obligatoire de l'onboarding)
│   ├── privacy-consent.tsx       (affiché juste avant/pendant l'inscription)
│   ├── login.tsx
│   └── forgot-password.tsx
├── (import)/
│   ├── choose-source.tsx        (CSV ou PDF)
│   ├── upload.tsx
│   ├── column-mapping.tsx       (CSV uniquement)
│   ├── review-lines.tsx         (lignes incertaines / doublons / erreurs)
│   └── confirm.tsx
├── (tabs)/
│   ├── dashboard.tsx
│   ├── transactions.tsx
│   ├── subscriptions.tsx
│   ├── savings.tsx
│   └── settings.tsx
├── index.tsx                     (écran de démarrage : valide la session, puis oriente)
├── expense/
│   ├── new.tsx                   (ajouter une transaction manquante — §10)
│   └── [id].tsx                  (corriger ou supprimer une transaction — §10)
├── subscription-detail/[id].tsx
├── comparison/[expenseId].tsx
├── billing/
│   ├── pricing.tsx
│   └── manage-subscription.tsx
├── account/
│   ├── export.tsx
│   └── delete-account.tsx
├── help.tsx
├── contact.tsx
└── legal/
    ├── privacy.tsx
    ├── terms.tsx
    └── cookies.tsx
```

Total : **31 écrans** et 2 layouts (`app/_layout.tsx`, `app/(tabs)/_layout.tsx`). Les groupes `(onboarding)`, `(auth)` et `(import)` n'ont pas de layout propre : leurs écrans sont enregistrés directement dans la pile racine, et le préfixe de groupe est retiré de l'URL — c'est ce qui fait que le lien profond `subscription-manager://reset-password?token=…` atteint bien `(auth)/reset-password.tsx`.

Écrans explicitement **absents** de la V1 (voir `CLAUDE.md` §1 et `RECAP_FONCTIONNALITES.md`) : espace famille/multi-profils, comparateur mondial complet, chatbot ouvert, widgets, réglages financiers avancés, tablette dédiée.

---

## 3. Écran d'accueil / onboarding

Message principal (EN par défaut) : *« Import your bank statement. Find recurring payments. Discover ways to save. »* Boutons : *Get started*, *Log in*, sélecteur de langue.

- Ne jamais présenter l'application comme une banque ou un conseiller financier.
- Onboarding limité à 4 écrans, dans cet ordre strict : bienvenue → langue/pays/devise → consentement confidentialité → **création de compte (obligatoire)**. Aucune étape n'est saut-able : impossible d'atteindre `(import)` ou `(tabs)` sans être passé par l'inscription.
- **Aucun mode invité.** *Get started* mène à l'onboarding puis à l'inscription — jamais directement à un écran fonctionnel. Il n'existe aucun bouton « essayer sans compte » ni aucun aperçu de l'import avant que le compte soit créé et la session obtenue.
- La saisie manuelle n'apparaît **jamais** comme une option mise en avant à l'onboarding.

### 3.1 Garde de navigation (root layout)

Le layout racine d'Expo Router lit le token de session stocké (`expo-secure-store`) au démarrage :

```ts
// apps/mobile/app/_layout.tsx (logique conceptuelle)
const { data: session, isLoading } = useSession(); // lit SecureStore + valide via GET /api/auth/session

if (isLoading) return <SplashScreen />;

const inAuthGroup = segments[0] === "(auth)" || segments[0] === "(onboarding)";

if (!session && !inAuthGroup) {
  return <Redirect href="/(onboarding)/welcome" />;
}
if (session && inAuthGroup) {
  return <Redirect href="/(tabs)/dashboard" />;
}
```

Cette garde s'applique à **tous** les écrans hors `(onboarding)` et `(auth)`, y compris via lien profond (deep link) : un lien externe pointant vers `/subscription-detail/123` sans session valide redirige d'abord vers l'inscription. Elle est un filet de sécurité UX — la vérité d'autorisation reste côté serveur (`requireUser()` sur chaque route API, règle `CLAUDE.md` §5.14) : la garde de navigation seule ne suffit jamais à protéger une donnée.

---

## 4. Import (voir `specs/import-releves.md` pour la logique serveur)

- `choose-source.tsx` : CSV mis en avant en premier, PDF en second choix, avec la mention obligatoire de compatibilité limitée pour le PDF.
- `review-lines.tsx` doit afficher clairement : nombre de transactions détectées, période couverte, devise, débits/crédits, lignes non reconnues, doublons possibles, transactions à montant inhabituel — avec actions *Confirm* / *Modify* / *Exclude* / *Cancel import*.
- Aucun calcul (total, doublons, confiance) n'est recalculé côté mobile : tout vient du DTO de preview renvoyé par le serveur.

---

## 5. Dashboard

Cartes principales : dépenses du mois, abonnements détectés, coût annuel récurrent, éléments à vérifier — chacune avec valeur, devise, période explicite (jamais une valeur sans période).

Sections : évolution des dépenses (un seul graphique simple sur 6 mois, pas de graphique avancé en V1), abonnements détectés, prochaines échéances estimées, hausses de prix, économies potentielles/confirmées (toujours visuellement distinctes), résumé IA du mois (voir `specs/comparateur-et-assistant-ia.md` §B).

Le composant graphique reçoit uniquement des données déjà calculées côté serveur — il ne recalcule jamais un montant.

---

## 6. Page Abonnements (Subscriptions)

Pour chaque récurrence : service, catégorie, montant, devise, fréquence, coût annuel, dernier paiement, prochaine date estimée (présentée comme une prévision, jamais une certitude), variation du montant, niveau de confiance, statut (`à confirmer`, `confirmé`, `ignoré`, `annulé`).

---

## 7. Comparaison

Pour chaque offre reconnue : coût actuel, coût annuel, options moins chères, différence annuelle, limites de l'offre, date de dernière vérification. Exemple de formulation produit :

> *« Your current plan costs €179.88 per year. A lower-priced option may cost €143.88 per year, but includes fewer features. »*

Si aucune alternative fiable n'existe : *« No verified alternative available. »*

---

## 8. Économies

Économies potentielles, économies confirmées (jamais mélangées visuellement), un objectif d'épargne, une liste d'actions recommandées. Pas de virement automatique, pas de cagnotte, pas d'investissement, pas d'épargne automatique, pas de conseil personnalisé complexe. Une économie ne devient confirmée que lorsque l'utilisateur la valide explicitement.

Concrètement, la validation explicite est le champ « montant réellement économisé » d'un objectif : l'écran le renvoie à `PATCH /api/savings/:id`, et le serveur en dérive le statut de l'objectif. C'est le **seul** chemin vers une économie confirmée. Les deux montants affichés en tête (potentiel, confirmé) viennent de `GET /api/dashboard` : ils sont calculés par le serveur, jamais par l'écran.

---

## 9. Assistant IA (résumé dashboard uniquement)

Voir `specs/comparateur-et-assistant-ia.md` Partie B. Aucune interface de type chat libre. Le composant affiche uniquement : résumé du mois, explication d'une hausse, une recommandation — jamais de zone de saisie de question libre en V1.

Implémenté par `components/ai-assistant.tsx`, affiché dans le tableau de bord. Les trois requêtes (`POST /api/ai/summary`, `/api/ai/explain-increase`, `/api/ai/recommendation`) partent avec un **corps vide** : le contexte est constitué côté serveur à partir de chiffres déjà calculés (B.5). Le mobile ne peut donc ni orienter la réponse, ni envoyer de texte libre, ni contourner le quota — décompté par le serveur avant l'appel au provider. Le composant affiche le niveau d'incertitude déclaré, le quota restant, et signale explicitement une réponse `degraded` (repli statique traduit).

Quand l'IA est désactivée côté serveur (`AI_PROVIDER=none`, valeur par défaut), `GET /api/ai/summary` renvoie `enabled: false` : la carte n'affiche alors qu'un avis traduit (`errors.AI_UNAVAILABLE`), sans bouton ni compteur de crédits. Le reste du tableau de bord est inchangé, et l'activation ultérieure d'un provider ne demande aucune mise à jour de l'application.

---

## 10. Saisie manuelle (fonction secondaire uniquement)

Accessible uniquement depuis un menu secondaire (« Ajouter une transaction manquante » / « Corriger cette transaction »), jamais depuis l'onboarding ni depuis un bouton principal du dashboard. Réutilise les mêmes schémas Zod que l'import (`packages/shared/validation`).

Parcours réel :

```
Transactions → « Ajouter une transaction manquante » → expense/new.tsx
             → POST /api/expenses → retour à la liste

Transactions → appui sur une ligne → expense/[id].tsx
             → PATCH /api/expenses/:id  (correction)
             → DELETE /api/expenses/:id (suppression, après confirmation)
```

Garanties tenues par le serveur, et rendues visibles par l'écran :
- `source = MANUAL` est écrit par le serveur ; le client ne peut pas faire passer une saisie pour une ligne importée ;
- sur une ligne importée, `merchantRaw` et `merchantNormalized` ne sont **jamais** transmis : la correction de libellé passe par `merchantOverride`, et le champ vide signifie « conserver le libellé du relevé » ;
- le montant saisi est transcrit en unités mineures par manipulation de chaîne (`lib/money-input.ts`), jamais par arithmétique flottante (CLAUDE.md §5.2) ;
- toute écriture invalide les transactions, les récurrences, le tableau de bord et les économies.

---

## 11. Paramètres, facturation, compte

- `pricing.tsx` : présente Free et Plus (aucune mention de Pro), prix affichés via la configuration du store (voir `specs/paiement-in-app.md`).
- `manage-subscription.tsx` : renvoie vers la gestion d'abonnement native du store (Google Play / réglages Apple ID) — l'application ne réimplémente pas d'écran de gestion de carte bancaire.
- `delete-account.tsx` : si `canDeleteAccount()` renvoie `false` (voir `specs/auth-comptes-rgpd.md` §9), afficher explicitement le blocage et un lien direct vers `manage-subscription.tsx` pour résilier d'abord.

---

## 12. Pages légales & support

`legal/privacy.tsx`, `legal/terms.tsx`, `legal/cookies.tsx`, `help.tsx`, `contact.tsx` — contenu statique traduit (en/fr/es), également publié en version web minimale sur `apps/api` (URL publique requise par Google Play Console et App Store Connect, voir `ACTIONS_MANUELLES.md`). La politique de cookies/traceurs doit explicitement mentionner l'absence de tout SDK publicitaire ou d'analytics comportemental tiers (voir `CLAUDE.md` §1).

---

## 13. i18n — règles

- Trois langues obligatoires : `en` (défaut), `fr`, `es`.
- Aucun texte codé en dur dans un composant — toujours une clé de traduction.
- Les messages d'erreur serveur (`ApiError.error.code`) sont mappés vers un texte traduit côté mobile, jamais affichés bruts.
- Un changement de langue ne modifie jamais automatiquement le pays ou la devise (et réciproquement) — testé explicitement.

---

## 14. Responsive & accessibilité (voir `CLAUDE.md` §2.5)

- Aucune dimension fixe en pixels pour la mise en page principale ; flexbox/pourcentages uniquement.
- `SafeAreaView`/`useSafeAreaInsets` sur tous les écrans.
- Support du dynamic type (échelle de police) sans troncature ni chevauchement.
- Tous les KPI et boutons ont un label accessible ; aucune information n'est communiquée uniquement par la couleur (ex. afficher `↑ +12.4 %` et pas seulement une pastille verte/rouge).
- Boutons de confirmation/suppression accessibles au clavier externe / lecteur d'écran (VoiceOver / TalkBack).
- États explicitement gérés pour chaque écran : `loading`, `success`, `empty`, `validation error`, `server error`, `permission error`, `rate limit`. Pour l'import : `idle → uploading → parsing → preview → validation_error → ready_to_import → importing → completed → rollback_available`.
  - Ces neuf états sont **tous atteignables** et implémentés dans `lib/import-state.ts` : `preview`, `validation_error` et `ready_to_import` sont dérivés de l'aperçu serveur et des exclusions de l'utilisateur, `parsing` correspond à la réanalyse avec correspondance de colonnes, et `rollback_available` signifie « lot enregistré et encore annulable » — jamais « annulation effectuée ».
  - Chaque état a un libellé traduit dans une table exhaustive (`Record<ImportState, string>`) : aucun nom d'état technique n'est jamais affiché tel quel.

---

## 15. Tests

- [ ] Chaque écran testé sur 4 tailles d'écran de référence (§`CLAUDE.md` 2.5).
- [ ] i18n : navigation, formulaires, erreurs, dashboard, aide, pages légales testés dans les 3 langues.
- [ ] Un changement de langue ne modifie pas le pays ni la devise (et inversement).
- [ ] Aucun écran ne recalcule un montant ou un score de confiance déjà fourni par l'API.

---

## 16. Checklist d'acceptation

- [ ] Parcours principal = création de compte obligatoire → import, pas saisie manuelle.
- [ ] Aucun écran fonctionnel n'est atteignable sans session valide — vérifié y compris par lien profond (deep link) et par appel API direct sans token.
- [ ] Toutes les pages listées existent en `en`, `fr`, `es`.
- [ ] Responsive validé sur les tailles de référence, pas de scroll horizontal non intentionnel.
- [ ] États loading/empty/error gérés partout.
- [ ] Aucune fonctionnalité hors V1 (famille, widgets, chatbot libre, etc.) présente dans la navigation.