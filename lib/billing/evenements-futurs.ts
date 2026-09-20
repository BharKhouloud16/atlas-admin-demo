// COMPANY ATLAS — V2.2-C/V2.2-D : Billing Foundation — événements métier
// futurs.
//
// Mandat CEO V2.2-C section 18 puis V2.2-D section 18 (même demande,
// reconduite) : "identifier les événements futurs" pour le
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
  | "INVOICE_PAID" // (V2.2-D) lib/billing/paiement.ts, enregistrerPaiement() — quand statutDepuisSolde() renvoie PAYEE (solde atteint zéro)
  | "PAYMENT_CREATED" // (V2.2-D) lib/billing/paiement.ts, enregistrerPaiement() — dès la création de la ligne Paiement, avant même l'évaluation du nouveau statut de Facture
  | "PAYMENT_RECEIVED" // alias conceptuel de "PAYMENT_CONFIRMED" (mandat V2.2-D section 18) — même point de code : enregistrerPaiement() (jamais sur dejaEnregistre: true)
  | "PAYMENT_PARTIAL" // même point que PAYMENT_RECEIVED, quand statutDepuisSolde() renvoie PARTIELLEMENT_PAYEE
  | "PAYMENT_FAILED" // lib/billing/paiement.ts, enregistrerPaiement() — résultat { ok: false }, notamment SOLDE_DEPASSE
  | "PAYMENT_CANCELLED" // (V2.2-D) lib/billing/paiement.ts, annulerPaiement() — transition CONFIRME -> ANNULE réussie (jamais sur dejaAnnule: true)
  | "BALANCE_ANOMALY" // (V2.2-D) aucun détecteur n'existe — naîtrait d'une lecture de calculerSolde() révélant un résultat négatif ou incohérent avec le statut stocké (jamais censé arriver, voir lib/billing/solde.ts — un signal d'anomalie, pas une règle métier)
  | "DISPUTE_CREATED" // aucune entité Litige n'existe (mandat section 19, non construite dans ce lot) — naîtrait d'une future Facture.motifAnnulation qualifié, ou d'une action Client dédiée
  | "DISPUTE_RESOLVED" // idem — dépend d'abord de DISPUTE_CREATED
  | "REGULATORY_CHANGE"; // lib/billing/regle-fiscale.ts — naîtrait de l'activation d'une nouvelle RegleFiscale (statut -> ACTIVE) pour une juridiction déjà couverte par une règle existante
