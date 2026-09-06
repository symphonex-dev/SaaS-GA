# RECAP_FONCTIONNALITES.md — Synthèse produit Gestionnaire d'abonnements (V1 mobile)

Document à destination humaine (non technique) : résume ce que fait le produit, pour qui, et ce qu'il garantit. Ne contient aucun détail d'implémentation — voir `specs/*.md` pour cela.

---

## 1. Qu'est-ce que Gestionnaire d'abonnements ?

*(Nom du projet renommé depuis « SaveWise » — voir `CLAUDE.md` §1 pour le détail du nommage par langue/store.)*

Gestionnaire d'abonnements est une application mobile qui analyse un relevé bancaire importé (fichier CSV ou PDF) pour :
- détecter automatiquement les abonnements et dépenses récurrentes ;
- calculer leur coût réel mensuel et annuel ;
- signaler les hausses de prix ;
- comparer certains abonnements à une sélection d'offres vérifiées ;
- proposer des économies potentielles.

L'application **n'est pas** une banque, **ne se connecte pas** directement aux comptes bancaires (pas d'Open Banking en V1), et **ne donne pas** de conseils financiers personnalisés complexes.

---

## 2. Public cible

Toute personne souhaitant reprendre le contrôle de ses abonnements et dépenses récurrentes sans avoir à tout ressaisir manuellement — elle possède déjà ses dépenses dans son application bancaire ; l'application les importe et les analyse.

---

## 3. Parcours principal

> Installer → choisir langue/pays/devise → **créer un compte (obligatoire)** → importer un relevé (CSV ou PDF) → vérifier les transactions détectées → consulter les abonnements détectés → consulter le dashboard → recevoir des recommandations.

**Aucun mode invité.** L'application n'est utilisable qu'après la création d'un compte — pas d'aperçu, pas d'essai, pas de premier import possible avant l'inscription. Seuls l'écran d'accueil, le choix de la langue et les écrans de connexion/inscription sont accessibles sans compte.

La saisie manuelle d'une dépense existe uniquement comme fonction secondaire (corriger une ligne importée, ajouter une dépense en espèces, ajouter une transaction absente du relevé) — ce n'est jamais l'action mise en avant.

---

## 4. Langues & devises

- Langues : anglais (par défaut), français, espagnol.
- Devises : EUR, USD, GBP, CAD, AUD.
- Langue, pays et devise sont choisis indépendamment les uns des autres.

---

## 5. Offres V1

| | Free | Plus |
|---|---|---|
| Import CSV | 1 import, période limitée | Illimité |
| Import PDF | Test/limité | Illimité |
| Abonnements suivis | Jusqu'à 5 | Illimité |
| Alertes de hausse de prix | Non | Oui |
| Comparateur | Limité | Avancé |
| Objectifs d'épargne | 1 | Plusieurs |
| Historique | Limité | Complet |
| Résumé IA mensuel | Limité | Quota supérieur |

Pas d'offre Pro, pas de multi-profils/famille, pas de connexion bancaire directe en V1 — ces éléments sont reportés à une version future.

---

## 6. Ce qui n'est volontairement pas dans la V1

- Connexion bancaire directe (Open Banking), synchronisation automatique.
- Saisie manuelle comme parcours principal.
- Chatbot financier ouvert ou conseils personnalisés complexes.
- Paiement Stripe ou toute passerelle de paiement web tierce — uniquement achat intégré via Google Play / Apple.
- Deux applications natives séparées — une seule base de code multiplateforme, Android publié en premier.
- Widgets, Apple Watch, raccourcis Siri/Google Assistant, intégration calendrier, mode hors-ligne complet, optimisation tablette.
- Tout SDK publicitaire ou d'analytics comportemental tiers.

---

## 7. Garanties de confidentialité

- Aucune donnée n'est collectée au-delà de ce qui est strictement nécessaire au fonctionnement (RGPD — minimisation des données).
- Aucun tracker publicitaire ou analytics comportemental tiers.
- Export complet des données personnelles disponible à tout moment (format JSON).
- Suppression de compte irréversible, disponible dès que l'utilisateur n'a plus d'abonnement payant actif (ou après résiliation de celui-ci).
- Le fichier de relevé bancaire importé (CSV/PDF) n'est **jamais** conservé durablement — il est supprimé immédiatement après extraction et confirmation des données.
- Aucune donnée bancaire (identifiants, numéro de carte) n'est jamais saisie ou stockée par l'application — les paiements passent exclusivement par les comptes Google/Apple de l'utilisateur.

---

## 8. Deux décisions produit à retenir

1. **Résiliation d'un abonnement Plus → l'utilisateur conserve l'accès payant jusqu'à la fin de la période déjà réglée**, comme partout ailleurs (Netflix, Spotify, etc.). Couper l'accès immédiatement au moment de la résiliation aurait été plus simple techniquement mais aurait généré des avis négatifs et des demandes de remboursement sur des périodes déjà payées. Détail technique dans `specs/paiement-in-app.md` §6. La suppression de compte, elle, se débloque dès la résiliation — sans attendre cette fin de période (§9 ci-dessous).
2. **L'import PDF est réservé à l'offre Plus** (Free n'y a droit qu'à un essai très limité). C'est le flux d'import le plus coûteux à traiter et le moins fiable des deux ; il constitue l'argument de mise à niveau naturel vers Plus, pendant que le CSV — gratuit, illimité et fiable — reste l'expérience de référence en Free. Détail dans `specs/import-releves.md` §5.

---

## 9. Pages disponibles

Accueil/onboarding, inscription, connexion, import (CSV/PDF), vérification de l'import, dashboard, transactions, abonnements, comparaison, économies, tarifs, gestion de l'abonnement, paramètres, aide, contact, confidentialité, conditions d'utilisation, cookies, export des données, suppression de compte.