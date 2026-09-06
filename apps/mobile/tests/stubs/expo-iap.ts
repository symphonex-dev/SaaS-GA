/**
 * Double de `expo-iap`.
 *
 * Il n'implémente **aucun achat** : sa seule raison d'être est de permettre à
 * `require('expo-iap')` de résoudre dans un environnement Node, et de vérifier
 * que l'application traite un module natif incomplet comme une capacité
 * absente plutôt que comme une panne.
 *
 * Aucun test ne fabrique un achat que le serveur accepterait : la vérification
 * reste entièrement côté serveur (`specs/paiement-in-app.md` §1).
 */
export default {};
