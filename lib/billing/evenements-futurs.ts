// COMPANY ATLAS — V2.2-C : Billing Foundation — événements métier futurs.
//
// Mandat CEO V2.2-C section 18 : "identifier les événements futurs" pour le
// futur système Notification/Attention Center (V2.3, explicitement hors
// périmètre de ce lot — voir section 26 "NE PAS commencer... Notifications,
// Attachments, Attention Center"). Ce fichier est PUREMENT déclaratif :
// aucun code de ce dépôt ne l'importe, aucun événement n'est émis, aucune
// file/queue/webhook n'existe. Il documente où, dans le code déjà écrit,
// chaque futur événement naîtrait naturellement — pour qu'un futur lot
// n'ait pas à redécouvrir ce mapping.
//
// Ne pas ajouter d'appel à ces types depuis lib/billing/* ou app/api/factures/*
// tant que V2.3 n'est pas mandaté — un type inutilisé n'a aucun effet de
// bord, un appel "prêt mais inactif" en aurait (complexité, dette, risque
// de comportement caché) et serait hors périmètre de ce lot.

export type EvenementBillingFutur =
  | "INVOICE_CREATED" // lib/billing/creation.ts, creerFactureDepuisFeuille() — après création réussie (jamais sur dejaExistante: true)
  | "INVOICE_REQUIRES_VALIDATION" // même point que INVOICE_CREATED — une Facture BROUILLON attend une action Admin
  | "INVOICE_VALIDATED" // lib/billing/transitions.ts, validerFacture() — transition BROUILLON -> VALIDEE réussie
  | "INVOICE_SENT" // lib/billing/transitions.ts, envoyerFacture() — transition VALIDEE -> ENVOYEE réussie (devient visible Client)
  | "INVOICE_DUE_SOON" // dérivé, jamais stocké — comparerait Facture.dateEcheance à la date courante (nécessite un ordonnanceur, absent de ce dépôt — voir lib/billing/etat-facture.ts, statutAffiche())
  | "INVOICE_OVERDUE" // dérivé, même remarque — aujourd'hui visible uniquement en lecture via statutAffiche() -> "ECHUE"
  | "PAYMENT_RECEIVED" // lib/billing/paiement.ts, enregistrerPaiement() — paiement confirmé menant à PAYEE ou PARTIELLEMENT_PAYEE (jamais sur dejaEnregistre: true)
  | "PAYMENT_PARTIAL" // même point que PAYMENT_RECEIVED, quand statutDepuisSolde() renvoie PARTIELLEMENT_PAYEE
  | "PAYMENT_FAILED" // lib/billing/paiement.ts, enregistrerPaiement() — résultat { ok: false }, notamment SOLDE_DEPASSE
  | "DISPUTE_CREATED" // aucune entité Litige n'existe (mandat section 19, non construite dans ce lot) — naîtrait d'une future Facture.motifAnnulation qualifié, ou d'une action Client dédiée
  | "DISPUTE_RESOLVED" // idem — dépend d'abord de DISPUTE_CREATED
  | "REGULATORY_CHANGE"; // lib/billing/regle-fiscale.ts — naîtrait de l'activation d'une nouvelle RegleFiscale (statut -> ACTIVE) pour une juridiction déjà couverte par une règle existante
