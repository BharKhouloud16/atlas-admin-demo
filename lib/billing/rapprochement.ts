// COMPANY ATLAS — V2.2-D : Billing — Rapprochement financier (préparation).
//
// Mandat CEO V2.2-D section 11 : "préparer les références et données
// nécessaires" au futur rapprochement TRANSACTION -> PAIEMENT -> FACTURE ->
// CLIENT, explicitement "provider-agnostic" et sans intégrer Stripe/Adyen/
// une API bancaire (section 28). Ce fichier est PUREMENT déclaratif : il ne
// fait aucun appel réseau, ne dépend d'aucun provider, et n'est importé par
// aucun code applicatif — il documente comment les champs déjà persistés en
// V2.2-B/D correspondent aux quatre niveaux du rapprochement cible, pour
// qu'un futur lot n'ait pas à redécouvrir ce mapping.
//
// TRANSACTION (bancaire/provider, future — aucune entité dédiée aujourd'hui)
//   Le futur rapprochement automatique matcherait une transaction externe
//   (relevé bancaire, webhook provider) à un Paiement existant via
//   Paiement.reference (déjà la seule donnée libre saisie par l'Admin à
//   l'enregistrement — voir lib/billing/paiement.ts, enregistrerPaiement)
//   et Paiement.methode (ex. "Virement", "Carte" — catégorie, jamais un
//   identifiant de provider). Aucune conversion de devise n'existe (voir
//   mandat section 6) : un futur rapprochement multi-devises resterait à
//   concevoir, jamais implicite.
//
// PAIEMENT (existant, V2.2-B/D)
//   Paiement { id, factureId, montant, devise, datePaiement, reference,
//   methode, statut } — statut CONFIRME/ANNULE, jamais supprimé (voir
//   lib/billing/paiement.ts annulerPaiement(), V2.2-D : une correction
//   change le statut, jamais l'historique). @@unique([factureId,
//   reference]) est déjà la garde d'idempotence qu'un rapprochement
//   automatique réutiliserait pour éviter un double-comptage.
//
// FACTURE (existant, V2.2-B)
//   Facture.paiements (relation 0..N) + lib/billing/solde.ts calculerSolde()
//   donnent déjà, à tout instant, "ce qui est payé" et "ce qui reste dû"
//   pour une Facture — la base du futur "Combien devons-nous recevoir ?"
//   (mandat CEO V2.2-D section 17).
//
// CLIENT (existant, V1)
//   Facture.clientId -> Client, déjà la frontière d'ownership appliquée
//   partout (app/api/factures/*, lib/billing/adapter.ts) — le futur
//   Receivables/Cash Intelligence (section 17) agrégerait par Client sans
//   nouvelle relation à construire.
//
// Ce qui reste volontairement HORS PÉRIMÈTRE (mandat sections 11/25/28) :
// aucune intégration de provider de paiement, aucune détection automatique
// d'anomalie, aucune IA décisionnaire sur un paiement financier.
export {};
