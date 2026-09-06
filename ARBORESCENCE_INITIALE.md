# ARBORESCENCE_INITIALE.md — Arborescence à créer dans VS Code + pilotage des specs

Ce document a deux rôles :
1. donner l'arborescence exacte des fichiers/dossiers à créer au départ ;
2. indiquer, **pour ton pilotage personnel uniquement**, quel modèle utiliser pour exécuter chaque fichier de `specs/`. Cette information ne doit apparaître nulle part ailleurs (ni dans le code, ni dans `CLAUDE.md`, ni dans les fichiers `specs/*.md` eux-mêmes).

Ordre d'exécution recommandé (voir aussi `CLAUDE.md` §7) : `schema-donnees` → `auth-comptes-rgpd` → `import-releves` → `moteur-recurrence` → `calculs-financiers` → `ui-composants-mobile` → `comparateur-et-assistant-ia` → `paiement-in-app`.

---

## 2. Arborescence initiale complète

```
subscription-manager/
├── CLAUDE.md
├── RECAP_FONCTIONNALITES.md
├── ACTIONS_MANUELLES.md
├── ARBORESCENCE_INITIALE.md
├── README.md
├── package.json
├── .gitignore
├── .env.example
├── eslint.config.mjs
├── prettier.config.mjs
├── specs/
│   ├── schema-donnees.md
│   ├── auth-comptes-rgpd.md
│   ├── import-releves.md
│   ├── moteur-recurrence.md
│   ├── calculs-financiers.md
│   ├── comparateur-et-assistant-ia.md
│   ├── paiement-in-app.md
│   └── ui-composants-mobile.md
│
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   ├── tsconfig.json
│   │   ├── postcss.config.mjs
│   │   ├── .env.local
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── api/
│   │   │   │   │   ├── auth/
│   │   │   │   │   │   ├── register/route.ts
│   │   │   │   │   │   ├── login/route.ts
│   │   │   │   │   │   ├── logout/route.ts
│   │   │   │   │   │   ├── request-password-reset/route.ts
│   │   │   │   │   │   ├── reset-password/route.ts
│   │   │   │   │   │   └── session/route.ts
│   │   │   │   │   ├── account/
│   │   │   │   │   │   ├── me/route.ts
│   │   │   │   │   │   ├── preferences/route.ts
│   │   │   │   │   │   ├── export/route.ts
│   │   │   │   │   │   └── route.ts
│   │   │   │   │   ├── expenses/
│   │   │   │   │   │   ├── route.ts
│   │   │   │   │   │   └── [id]/route.ts
│   │   │   │   │   ├── imports/
│   │   │   │   │   │   ├── preview/route.ts
│   │   │   │   │   │   ├── confirm/route.ts
│   │   │   │   │   │   └── [id]/
│   │   │   │   │   │       ├── route.ts
│   │   │   │   │   │       └── rollback/route.ts
│   │   │   │   │   ├── recurring/
│   │   │   │   │   │   └── [id]/
│   │   │   │   │   │       ├── confirm/route.ts
│   │   │   │   │   │       ├── route.ts
│   │   │   │   │   │       └── reject/route.ts
│   │   │   │   │   ├── comparisons/
│   │   │   │   │   │   ├── route.ts
│   │   │   │   │   │   └── [expenseId]/
│   │   │   │   │   │       ├── route.ts
│   │   │   │   │   │       ├── offers/route.ts
│   │   │   │   │   │       └── refresh/route.ts
│   │   │   │   │   ├── savings/
│   │   │   │   │   │   ├── route.ts
│   │   │   │   │   │   └── [id]/route.ts
│   │   │   │   │   ├── dashboard/route.ts
│   │   │   │   │   ├── ai/
│   │   │   │   │   │   ├── summary/route.ts
│   │   │   │   │   │   ├── explain-increase/route.ts
│   │   │   │   │   │   └── recommendation/route.ts
│   │   │   │   │   ├── billing/
│   │   │   │   │   │   └── purchase/verify/route.ts
│   │   │   │   │   ├── webhooks/
│   │   │   │   │   │   ├── google-play/route.ts
│   │   │   │   │   │   └── app-store/route.ts
│   │   │   │   │   └── admin/
│   │   │   │   │       └── comparison-offers/
│   │   │   │   │           ├── route.ts
│   │   │   │   │           ├── [id]/route.ts
│   │   │   │   │           └── [id]/verify/route.ts
│   │   │   │   ├── [locale]/
│   │   │   │   │   ├── privacy/page.tsx
│   │   │   │   │   ├── terms/page.tsx
│   │   │   │   │   ├── cookies/page.tsx
│   │   │   │   │   ├── help/page.tsx
│   │   │   │   │   ├── contact/page.tsx
│   │   │   │   │   └── layout.tsx
│   │   │   │   ├── globals.css
│   │   │   │   └── layout.tsx
│   │   │   ├── components/
│   │   │   │   └── public/
│   │   │   ├── lib/
│   │   │   │   ├── env/
│   │   │   │   │   ├── server.ts
│   │   │   │   │   └── client.ts
│   │   │   │   ├── db/
│   │   │   │   │   └── prisma.ts
│   │   │   │   ├── security/
│   │   │   │   │   └── password.ts
│   │   │   │   ├── merchant/
│   │   │   │   │   └── normalize.ts
│   │   │   │   ├── csv/
│   │   │   │   │   ├── encoding.ts
│   │   │   │   │   ├── delimiter.ts
│   │   │   │   │   ├── parser.ts
│   │   │   │   │   ├── date.ts
│   │   │   │   │   ├── amount.ts
│   │   │   │   │   ├── duplicate.ts
│   │   │   │   │   └── mapping.ts
│   │   │   │   ├── pdf/
│   │   │   │   │   ├── extract.ts
│   │   │   │   │   ├── line-classifier.ts
│   │   │   │   │   └── confidence.ts
│   │   │   │   ├── recurring/
│   │   │   │   │   ├── interval.ts
│   │   │   │   │   ├── amount.ts
│   │   │   │   │   ├── frequency.ts
│   │   │   │   │   ├── confidence.ts
│   │   │   │   │   └── normalize.ts
│   │   │   │   ├── finance/
│   │   │   │   │   ├── money.ts
│   │   │   │   │   ├── totals.ts
│   │   │   │   │   ├── averages.ts
│   │   │   │   │   ├── comparisons.ts
│   │   │   │   │   ├── projections.ts
│   │   │   │   │   ├── savings.ts
│   │   │   │   │   └── currency.ts
│   │   │   │   ├── i18n/
│   │   │   │   └── validation/
│   │   │   ├── server/
│   │   │   │   ├── services/
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   ├── user.service.ts
│   │   │   │   │   ├── expense.service.ts
│   │   │   │   │   ├── import.service.ts
│   │   │   │   │   ├── recurring-detection.service.ts
│   │   │   │   │   ├── comparison.service.ts
│   │   │   │   │   ├── savings.service.ts
│   │   │   │   │   ├── dashboard.service.ts
│   │   │   │   │   └── billing.service.ts
│   │   │   │   ├── repositories/
│   │   │   │   │   ├── user.repository.ts
│   │   │   │   │   ├── expense.repository.ts
│   │   │   │   │   ├── comparison.repository.ts
│   │   │   │   │   └── subscription.repository.ts
│   │   │   │   ├── policies/
│   │   │   │   ├── jobs/
│   │   │   │   └── ai/
│   │   │   │       ├── ai.service.ts
│   │   │   │       ├── ai.provider.ts
│   │   │   │       ├── ai.schemas.ts
│   │   │   │       ├── ai.quota.ts
│   │   │   │       ├── ai.prompt.ts
│   │   │   │       ├── ai.context.ts
│   │   │   │       ├── ai.guardrails.ts
│   │   │   │       ├── ai.redaction.ts
│   │   │   │       └── providers/
│   │   │   │           ├── openai.provider.ts
│   │   │   │           └── mock.provider.ts
│   │   │   ├── types/
│   │   │   └── locales/
│   │   │       ├── en/
│   │   │       ├── fr/
│   │   │       └── es/
│   │   └── tests/
│   │       ├── unit/
│   │       ├── integration/
│   │       └── e2e/
│   │
│   └── mobile/
│       ├── package.json
│       ├── app.json
│       ├── tsconfig.json
│       ├── tailwind.config.js
│       ├── babel.config.js
│       ├── app/
│       │   ├── (onboarding)/
│       │   │   ├── welcome.tsx
│       │   │   ├── language-country-currency.tsx
│       │   │   └── privacy-consent.tsx
│       │   ├── (auth)/
│       │   │   ├── register.tsx
│       │   │   ├── login.tsx
│       │   │   └── forgot-password.tsx
│       │   ├── (import)/
│       │   │   ├── choose-source.tsx
│       │   │   ├── upload.tsx
│       │   │   ├── column-mapping.tsx
│       │   │   ├── review-lines.tsx
│       │   │   └── confirm.tsx
│       │   ├── (tabs)/
│       │   │   ├── dashboard.tsx
│       │   │   ├── transactions.tsx
│       │   │   ├── subscriptions.tsx
│       │   │   ├── savings.tsx
│       │   │   └── settings.tsx
│       │   ├── subscription-detail/[id].tsx
│       │   ├── comparison/[expenseId].tsx
│       │   ├── billing/
│       │   │   ├── pricing.tsx
│       │   │   └── manage-subscription.tsx
│       │   ├── account/
│       │   │   ├── export.tsx
│       │   │   └── delete-account.tsx
│       │   ├── help.tsx
│       │   ├── contact.tsx
│       │   ├── legal/
│       │   │   ├── privacy.tsx
│       │   │   ├── terms.tsx
│       │   │   └── cookies.tsx
│       │   └── _layout.tsx
│       ├── components/
│       ├── lib/
│       │   ├── api-client.ts
│       │   ├── query-client.ts
│       │   └── secure-storage.ts
│       ├── locales/
│       │   ├── en.json
│       │   ├── fr.json
│       │   └── es.json
│       ├── store/
│       └── tests/
│
└── packages/
    └── shared/
        ├── package.json
        ├── types/
        │   ├── user.ts
        │   ├── expense.ts
        │   ├── comparison.ts
        │   ├── subscription.ts
        │   └── api.ts
        ├── validation/
        └── constants/
            ├── currencies.ts
            ├── countries.ts
            ├── locales.ts
            └── plans.ts
```

