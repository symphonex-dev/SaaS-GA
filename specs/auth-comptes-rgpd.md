# specs/auth-comptes-rgpd.md — Authentification, comptes, sécurité, RGPD

Niveau : flux standards (CRUD, sécurité par bibliothèques éprouvées, pas d'algorithme métier custom). Référence le schéma dans `specs/schema-donnees.md`.

---

## 1. Principes

- Zero Trust côté client : toute donnée venant de `apps/mobile` est considérée hostile tant qu'elle n'a pas été validée par Zod et réautorisée côté serveur.
- Le `userId` courant provient **uniquement** de la session authentifiée, jamais d'un champ envoyé par le client.
- Aucune fonctionnalité de suppression de compte, d'export, ou de connexion ne doit être accessible sans passer par `requireUser()`.

```ts
export interface AuthenticatedUser {
  id: string;
  email: string;
  tier: "FREE" | "PLUS";
  language: "en" | "fr" | "es";
  country: string;
  currency: "EUR" | "USD" | "GBP" | "CAD" | "AUD";
}

export async function requireUser(): Promise<AuthenticatedUser>;
export async function getCurrentUser(): Promise<AuthenticatedUser | null>;
```

`requireUser()` : lit le token depuis l'en-tête `Authorization: Bearer <token>` (§4), vérifie sa validité en base (`AuthSession`), recharge l'utilisateur, vérifie qu'il n'est pas supprimé (`deletedAt === null`), renvoie uniquement les champs nécessaires.

---

## 2. Acceptation des adresses e-mail (règle prioritaire)

L'inscription doit fonctionner avec **n'importe quelle adresse e-mail valide**, sans liste blanche de domaines. Schéma Zod :

```ts
export const registerSchema = z.object({
  email: z.string().trim().email().transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
  language: localeSchema,
  country: countrySchema,
  currency: currencySchema,
});
```

- Aucun filtre de domaine dans le code applicatif.
- Si un mécanisme anti-abus de domaines jetables/temporaires est ajouté plus tard, il doit être basé sur une liste de domaines *jetables connus* (blocklist), jamais sur une liste blanche restrictive, et **ne doit jamais** rejeter l'un des fournisseurs suivants — à couvrir explicitement par des tests d'intégration :

  `gmail.com`, `outlook.com` / `hotmail.com` / `live.com`, `protonmail.com` / `proton.me`, `tutanota.com` / `tuta.com`, `yahoo.com` / `yahoo.fr`, `orange.fr` / `wanadoo.fr`, `laposte.net`.

  Note : Samsung Email et Thunderbird sont des *clients* de messagerie (ils accèdent à un compte existant sur l'un des domaines ci-dessus ou un domaine personnalisé) et non des fournisseurs de domaine — aucune logique ne doit tenter de les détecter ou de les traiter spécifiquement.

```ts
tests/unit/email-providers.test.ts
// [ ] gmail.com accepté
// [ ] outlook.com / hotmail.com accepté
// [ ] protonmail.com / proton.me accepté
// [ ] tutanota.com / tuta.com accepté
// [ ] yahoo.com / yahoo.fr accepté
// [ ] orange.fr / wanadoo.fr accepté
// [ ] laposte.net accepté
// [ ] format RFC invalide rejeté (ex. "abc", "a@b")
```

---

## 3. Politique de mot de passe

- 12 caractères minimum, 128 maximum.
- Hash **Argon2id** en priorité ; **bcrypt** à coût élevé documenté si Argon2id indisponible sur l'environnement cible.
- Jamais MD5, SHA-1, SHA-256 seul, Base64, chiffrement réversible.
- Jamais de mot de passe ni de hash retourné au client, ni journalisé.

```ts
export async function hashPassword(password: string): Promise<string>;
export async function verifyPassword(password: string, hash: string): Promise<boolean>;
```

---

## 4. Connexion, session

```ts
export const loginSchema = z.object({
  email: z.string().trim().email().transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(128),
});
```

- La réponse ne doit jamais permettre l'énumération de comptes (message générique en cas d'échec, qu'il s'agisse d'un e-mail inconnu ou d'un mauvais mot de passe).
- **Session par token opaque, pas de cookie.** L'API est consommée uniquement par le client mobile natif (Expo/React Native) — jamais par un navigateur avec état de cookie partagé — donc aucun cookie de session n'est utilisé. À la connexion (ou à l'inscription), le serveur génère un token aléatoire cryptographiquement sûr, ne stocke que son hash, et renvoie le token brut **une seule fois** dans le corps de la réponse :

```ts
import { randomBytes, createHash } from "node:crypto";

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

- Le client mobile stocke ce token exclusivement dans `expo-secure-store` (jamais en `AsyncStorage`, jamais dans un state React persisté). Chaque requête vers une route protégée l'envoie via l'en-tête `Authorization: Bearer <token>`.
- `requireUser()` (§1) lit cet en-tête, hash le token reçu, cherche une `AuthSession` correspondante et non expirée/non révoquée (voir `specs/schema-donnees.md` §`AuthSession`), recharge l'utilisateur, vérifie `deletedAt === null`, et **met à jour `lastUsedAt`**.
- `POST /api/auth/logout` révoque la session côté serveur (`revokedAt = now()`) — le client supprime ensuite le token de `expo-secure-store`. La révocation serveur est ce qui rend la déconnexion réelle, pas seulement la suppression côté client.
- Expiration : durée de vie longue mais finie (ex. 90 jours glissants, renouvelée à chaque usage via `lastUsedAt`), pour limiter l'impact d'un token compromis tout en évitant de forcer une reconnexion trop fréquente sur mobile.
- Rate limiting dédié sur `login` (par IP + par e-mail tenté).

---

## 5. Réinitialisation de mot de passe

```ts
import { randomBytes, createHash } from "node:crypto";

export function generatePasswordResetToken(): string {
  return randomBytes(32).toString("base64url");
}
export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

- Le token brut ne transite que serveur → lien envoyé à l'utilisateur → utilisateur. Seul le hash est stocké.
- Usage unique, expiration courte, invalidé après utilisation.
- Réponse publique générique : « Si un compte correspondant existe, un e-mail de réinitialisation a été envoyé. »
- **La réponse reste identique même si l'envoi échoue.** La route n'appelle le transport que lorsque le compte existe : remonter l'erreur ferait du code HTTP un oracle d'énumération (200 pour une adresse inconnue, 500 pour une adresse connue). L'incident est absorbé et journalisé par le seul **nom** de l'erreur — ni adresse, ni lien, ni token.
- Transport réel obligatoire en production (`EMAIL_PROVIDER=resend`). `console` est refusé : le lien contient le token brut, et la sortie standard est collectée. Le message est traduit en `en`/`fr`/`es` par des gabarits statiques et ne contient que le lien et sa durée de validité — aucune donnée de compte (voir `apps/api/src/lib/mail/`).

---

## 6. Onboarding

Le choix de `language`/`country`/`currency` intervient **avant** la création de compte, dans l'onboarding mobile (`(onboarding)/language-country-currency.tsx`, voir `specs/ui-composants-mobile.md` §2-3), et est envoyé comme partie du payload `POST /api/auth/register` (`registerSchema` ci-dessus, §2). Il n'y a pas d'étape d'onboarding séparée après l'inscription : dès la session obtenue, l'utilisateur est redirigé directement vers le premier import.

Le endpoint `PATCH /api/account/preferences` ci-dessous reste disponible pour modifier ces préférences **ultérieurement**, depuis les Paramètres — jamais comme mécanisme de choix initial :

```ts
export const updatePreferencesSchema = z.object({
  language: localeSchema,
  country: countrySchema,
  currency: currencySchema,
});
```

Le serveur met à jour `User WHERE id = session.user.id` — jamais `WHERE id = body.userId`.

---

## 7. Routes API

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/request-password-reset
POST   /api/auth/reset-password
GET    /api/auth/session

GET    /api/account/me
PATCH  /api/account/preferences
GET    /api/account/export
DELETE /api/account
```

Format de réponse standard :

```ts
interface ApiSuccess<T> { success: true; data: T }
interface ApiError {
  success: false;
  error: { code: string; message: string; field?: string };
}
```

Codes d'erreur stables : `AUTH_INVALID_CREDENTIALS`, `AUTH_EMAIL_ALREADY_EXISTS`, `AUTH_RESET_TOKEN_INVALID`, `AUTH_RESET_TOKEN_EXPIRED`, `AUTH_UNAUTHORIZED`, `VALIDATION_ERROR`, `RATE_LIMITED`, `ACCOUNT_DELETION_BLOCKED_ACTIVE_SUBSCRIPTION`, `INTERNAL_ERROR`.

---

## 8. Export RGPD

```
GET /api/account/export
```

```ts
export interface UserDataExport {
  exportedAt: string;
  user: {
    id: string; email: string; language: string; country: string;
    currency: string; tier: "FREE" | "PLUS"; createdAt: string;
  };
  expenses: unknown[];
  recurringDetections: unknown[];
  savingsGoals: unknown[];
  subscription: unknown | null;
}
```

Ne jamais inclure : `passwordHash`, tokens de reset, secrets de session, identifiants de transaction des stores en clair au-delà de ce qui est nécessaire à l'utilisateur, secrets serveur. `Content-Disposition: attachment; filename="user-data.json"`.

---

## 9. Suppression de compte (règle prioritaire renforcée)

```
DELETE /api/account
```

```ts
export const deleteAccountSchema = z.object({
  confirmation: z.literal("DELETE_MY_ACCOUNT"),
});
```

**Précondition obligatoire, vérifiée côté serveur avant toute suppression** :

```ts
function canDeleteAccount(subscription: Subscription | null): boolean {
  if (subscription === null) return true;
  if (subscription.plan === "FREE") return true;
  if (subscription.status === "EXPIRED") return true;
  if (subscription.cancelAtPeriodEnd === true) return true;
  // Un abonnement payant encore actif ET non résilié (cancelAtPeriodEnd === false)
  // bloque la suppression tant qu'il n'a pas été résilié — peu importe qu'il reste
  // encore de l'accès payant jusqu'à currentPeriodEnd (voir specs/paiement-in-app.md §6/§8).
  return false;
}
```

Si `canDeleteAccount` renvoie `false`, l'API renvoie l'erreur `ACCOUNT_DELETION_BLOCKED_ACTIVE_SUBSCRIPTION` et invite l'utilisateur à résilier son abonnement d'abord (voir `specs/paiement-in-app.md` §6-§8). Résilier suffit à débloquer la suppression **immédiatement** — l'utilisateur n'a pas besoin d'attendre `currentPeriodEnd` : il peut supprimer son compte alors même qu'il conserve encore l'accès payant restant, auquel cas cet accès devient simplement sans objet.

Pipeline de suppression une fois la précondition validée :

```
Authentification
 ↓
Vérification confirmation + précondition abonnement
 ↓
Transaction
 ↓
Cascade : Expenses, RecurringDetection, UserSavingsGoal,
          Subscription, PasswordResetToken, AuthSession, ExpenseImportBatch, AiQuota
 ↓
Révocation explicite de toutes les AuthSession de l'utilisateur (`revokedAt = now()`), avant même la suppression en cascade — pour que la session en cours de la requête elle-même soit invalidée immédiatement, y compris en cas d'échec partiel de la transaction
 ↓
Confirmation générique
```

- Suppression irréversible après confirmation serveur.
- Un utilisateur supprimé ne peut plus s'authentifier.
- Aucune donnée d'un autre utilisateur n'est jamais affectée.

---

## 10. Sécurité applicative transverse

- HTTPS obligatoire en production, redirection HTTP→HTTPS, HSTS si la plateforme de déploiement le permet.
- Rate limiting distinct par domaine : `auth:login`, `auth:register`, `auth:reset`, `import:upload`, `ai:user:{userId}`, `api:general`, `store-notifications:{store}`.
- Le compteur est **partagé entre instances** (`RATE_LIMIT_STORE=postgres`, table `rate_limit_counters`) : en mémoire de process, N instances autorisent N fois la limite annoncée. L'incrément est un unique `INSERT … ON CONFLICT DO UPDATE … RETURNING`, ce qui empêche deux requêtes concurrentes de lire la même valeur puis de l'écrire toutes les deux. Si le compteur est momentanément injoignable, la requête est **autorisée** et l'incident journalisé sans identifiant : le rate limiting protège d'un abus, pas d'un accès non autorisé — l'autorisation, elle, échoue toujours fermée.
- Zod sur **toute** entrée (body, query, params) avant toute logique métier.
- Prisma exclusivement paramétré, aucune concaténation SQL.
- React Native : pas de `dangerouslySetInnerHTML` équivalent, pas de rendu de HTML/Markdown utilisateur non stérilisé.
- Aucun secret (session, IA, stores) dans `apps/mobile` — uniquement dans `apps/api` côté serveur, jamais dans une variable préfixée exposée au bundle client.
- Aucune donnée sensible dans `AsyncStorage` : le token de session brut n'existe que dans `expo-secure-store` côté client, et sous forme hashée dans `AuthSession` côté serveur — jamais en clair ni ailleurs.

---

## 11. Isolation multi-utilisateur — tests obligatoires

- [ ] User A ne peut pas lire une dépense de User B.
- [ ] User A ne peut pas modifier/supprimer une dépense de User B.
- [ ] User A ne peut pas consulter/rollback un import de User B.
- [ ] User A ne peut pas confirmer/modifier/rejeter une détection de User B.
- [ ] User A ne peut pas modifier un objectif d'épargne de User B.
- [ ] User A ne peut pas déclencher un appel IA avec le contexte de User B.
- [ ] User A ne peut pas accéder à l'abonnement de User B.

---

## 12. Checklist d'acceptation

- [ ] Inscription fonctionne avec les fournisseurs e-mail listés en §2.
- [ ] Mot de passe hashé Argon2id/bcrypt, jamais journalisé.
- [ ] Connexion, déconnexion, reset password fonctionnels ; pas d'énumération d'e-mails.
- [ ] Session par token opaque hashé (`AuthSession`) — pas de cookie ; token brut uniquement dans `expo-secure-store` côté client, jamais en clair côté serveur.
- [ ] `language`/`country`/`currency` sont fixés dès l'inscription (`registerSchema`) et modifiables ensuite uniquement sur l'utilisateur de la session (`PATCH /api/account/preferences`), jamais via un `userId` fourni par le client.
- [ ] Export JSON complet, sans secret, réservé au compte authentifié.
- [ ] Suppression bloquée tant qu'un abonnement payant actif n'est pas résilié (`ACCOUNT_DELETION_BLOCKED_ACTIVE_SUBSCRIPTION`).
- [ ] Suppression autorisée immédiatement si `plan = FREE` ou abonnement déjà résilié/expiré.
- [ ] Suppression en cascade testée, session invalidée, aucune donnée d'un autre utilisateur affectée.
- [ ] Rate limiting actif sur toutes les routes sensibles.
- [ ] Aucun secret dans les logs, dans le bundle mobile, ou hors `.env` côté serveur.