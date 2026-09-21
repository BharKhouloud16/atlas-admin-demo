import type { Facture, Paiement, ClientNeed } from "@prisma/client";
import type { AttentionCategorie, AttentionDestinataireType, AttentionPriorite, AttentionType } from "@prisma/client";
import { calculerSolde } from "@/lib/billing/solde";
import { statutAffiche } from "@/lib/billing/etat-facture";
import { detecterAnomalies, type AnomalieFacture } from "@/lib/billing/rapport-financier";

// COMPANY ATLAS — V2.3 : Communication Intelligence + Attention Center.
//
// Fonctions PURES, déterministes (mandat CEO V2.3 section 9) : aucune
// requête, aucune écriture, aucune IA générative. Chaque fonction prend les
// entités déjà chargées par l'appelant (voir lib/attention/synchronisation.ts,
// seul point qui touche la base) et produit des candidats — jamais une
// Attention persistée directement ici.
//
// Réutilise intégralement lib/billing/rapport-financier.ts (V2.2-E) et
// lib/billing/etat-facture.ts (V2.2-B) : Billing reste l'unique source de
// vérité (mandat section 11), ce fichier ne fait que traduire un fait déjà
// calculé ailleurs en Attention candidate — jamais une seconde logique de
// calcul du solde/statut/anomalie.

type FactureAvecPaiements = Facture & { paiements: Paiement[] };

export type ActionDisponible = { label: string; href: string };

export type AttentionCandidat = {
  type: AttentionType;
  categorie: AttentionCategorie;
  priorite: AttentionPriorite;
  titre: string;
  resume: string;
  raison: string;
  source: string;
  sourceId: string;
  recipientType: AttentionDestinataireType;
  recipientId: string | null;
  actionDisponible: ActionDisponible | null;
  metadata: Record<string, unknown> | null;
  expiresAt: Date | null;
};

// Vocabulaire fermé des `type` jamais générés que pour la source "Facture"
// — utilisé par synchronisation.ts pour savoir quelles lignes existantes
// auto-résoudre quand un candidat n'est plus produit (mandat section 9 :
// "résolution"). Toujours tenu à jour manuellement en même temps que les
// fonctions ci-dessous — jamais dérivé dynamiquement (fermeture volontaire).
export const TYPES_ATTENTION_FACTURE: AttentionType[] = [
  "FACTURE_ENVOYEE",
  "FACTURE_ECHEANCE_PROCHE",
  "FACTURE_ECHUE",
  "PAIEMENT_RECU",
  "PAIEMENT_PARTIEL",
  "PAIEMENT_ANNULE",
  "ANOMALIE_FINANCIERE",
];

export const TYPES_ATTENTION_BESOIN: AttentionType[] = ["BESOIN_A_CLARIFIER"];

// V2.5 — Communication Intelligence (Lot 2, 21/09/2026).
export const TYPES_ATTENTION_MESSAGE: AttentionType[] = ["MESSAGE_NON_LU"];

const JOURS_ECHEANCE_PROCHE = 7;
const JOURS_MS = 24 * 60 * 60 * 1000;

// Nombre de jours entre `maintenant` et `dateEcheance` — positif si
// l'échéance est encore à venir, négatif si elle est dépassée. Nom explicite
// (jamais un helper générique ambigu sur l'ordre des arguments) pour rester
// lisible à la relecture.
function joursAvantEcheance(dateEcheance: Date, maintenant: Date): number {
  return (dateEcheance.getTime() - maintenant.getTime()) / JOURS_MS;
}

// Candidats Client-safe issus du cycle de vie d'une Facture (mandat section
// 11, noms de type repris verbatim de la liste d'exemples donnée par le CEO).
// Au plus UN candidat par type possible par Facture (le solde/statut d'une
// Facture à un instant donné est univoque) — l'idempotence structurelle de
// la table Attention (@@unique([type, source, sourceId])) garantit qu'un
// même fait ne produit jamais plusieurs lignes au fil du temps, seulement
// une mise à jour de la même ligne (mandat section 8, anti-spam).
export function genererCandidatsFacture(facture: FactureAvecPaiements, maintenant: Date = new Date()): AttentionCandidat[] {
  const candidats: AttentionCandidat[] = [];
  const solde = calculerSolde(
    facture.montantTTC,
    facture.paiements.map((p) => ({ montant: p.montant, statut: p.statut }))
  );
  const soldeNombre = solde.toNumber();
  const montantTTCNombre = facture.montantTTC.toNumber();
  const statutAff = statutAffiche(facture.statut, facture.dateEcheance, maintenant);
  const base = { source: "Facture", sourceId: facture.id, recipientType: "CLIENT" as const, recipientId: facture.clientId };
  const metadataMontant = { montantTTC: montantTTCNombre, solde: soldeNombre, devise: facture.devise, numeroFacture: facture.numeroFacture };
  const action: ActionDisponible = { label: "Voir la facture", href: "/client/finance" };

  // FACTURE_ENVOYEE — information ponctuelle ("nouvelle facture disponible"),
  // expire après 30 jours (mandat section 8 : "prévoir expiration" — une
  // information qui n'est plus "nouvelle" ne doit pas rester affichée comme
  // telle indéfiniment).
  if (facture.dateEnvoi && statutAff !== "ANNULEE") {
    candidats.push({
      ...base,
      type: "FACTURE_ENVOYEE",
      categorie: "INFORMATION",
      priorite: "P3_BASSE",
      titre: `Facture ${facture.numeroFacture} disponible`,
      resume: `Nouvelle facture de ${montantTTCNombre.toFixed(2)} ${facture.devise}.`,
      raison: "Une facture vous a été envoyée.",
      actionDisponible: action,
      metadata: metadataMontant,
      expiresAt: facture.dateEnvoi ? new Date(facture.dateEnvoi.getTime() + 30 * JOURS_MS) : null,
    });
  }

  // FACTURE_ECHEANCE_PROCHE / FACTURE_ECHUE — mutuellement exclusifs par
  // construction (statutAffiche() ne retourne jamais les deux à la fois).
  if (statutAff === "ECHUE") {
    candidats.push({
      ...base,
      type: "FACTURE_ECHUE",
      categorie: "ALERTE",
      priorite: "P1_HAUTE",
      titre: `Facture ${facture.numeroFacture} en retard`,
      resume: `Échéance dépassée — solde restant : ${soldeNombre.toFixed(2)} ${facture.devise}.`,
      raison: "L'échéance de paiement est dépassée.",
      actionDisponible: action,
      metadata: metadataMontant,
      expiresAt: null,
    });
  } else if (
    (facture.statut === "ENVOYEE" || facture.statut === "PARTIELLEMENT_PAYEE") &&
    facture.dateEcheance &&
    joursAvantEcheance(facture.dateEcheance, maintenant) >= 0 &&
    joursAvantEcheance(facture.dateEcheance, maintenant) <= JOURS_ECHEANCE_PROCHE
  ) {
    candidats.push({
      ...base,
      type: "FACTURE_ECHEANCE_PROCHE",
      categorie: "ALERTE",
      priorite: "P2_NORMALE",
      titre: `Facture ${facture.numeroFacture} — échéance proche`,
      resume: `Échéance le ${facture.dateEcheance.toLocaleDateString("fr-FR")} — solde restant : ${soldeNombre.toFixed(2)} ${facture.devise}.`,
      raison: "L'échéance de paiement approche.",
      actionDisponible: action,
      metadata: metadataMontant,
      expiresAt: facture.dateEcheance,
    });
  }

  // PAIEMENT_RECU (solde nul, facture payée en totalité) / PAIEMENT_PARTIEL
  // (mandat section 8, exemple donné mot pour mot : "Facture #X — paiement
  // partiel reçu — solde restant : X" plutôt que plusieurs alertes séparées).
  if (facture.statut === "PAYEE") {
    candidats.push({
      ...base,
      type: "PAIEMENT_RECU",
      categorie: "INFORMATION",
      priorite: "P3_BASSE",
      titre: `Facture ${facture.numeroFacture} payée`,
      resume: `Paiement complet reçu — ${montantTTCNombre.toFixed(2)} ${facture.devise}.`,
      raison: "Le solde de cette facture est nul.",
      actionDisponible: action,
      metadata: metadataMontant,
      expiresAt: new Date(maintenant.getTime() + 30 * JOURS_MS),
    });
  } else if (facture.statut === "PARTIELLEMENT_PAYEE") {
    candidats.push({
      ...base,
      type: "PAIEMENT_PARTIEL",
      categorie: "INFORMATION",
      priorite: "P2_NORMALE",
      titre: `Facture ${facture.numeroFacture} — paiement partiel reçu`,
      resume: `Solde restant : ${soldeNombre.toFixed(2)} ${facture.devise}.`,
      raison: "Un paiement partiel a été enregistré sur cette facture.",
      actionDisponible: action,
      metadata: metadataMontant,
      expiresAt: null,
    });
  }

  // PAIEMENT_ANNULE — au moins un paiement CONFIRME a été annulé sur cette
  // facture (le solde a été rouvert) ; jamais généré si aucune annulation
  // n'a jamais eu lieu (pas un état par défaut).
  const auMoinsUnPaiementAnnule = facture.paiements.some((p) => p.statut === "ANNULE");
  if (auMoinsUnPaiementAnnule && statutAff !== "ANNULEE") {
    candidats.push({
      ...base,
      type: "PAIEMENT_ANNULE",
      categorie: "ALERTE",
      priorite: "P2_NORMALE",
      titre: `Facture ${facture.numeroFacture} — paiement annulé`,
      resume: `Un paiement a été annulé — solde restant : ${soldeNombre.toFixed(2)} ${facture.devise}.`,
      raison: "Un paiement précédemment confirmé a été annulé, le solde a été mis à jour.",
      actionDisponible: action,
      metadata: metadataMontant,
      expiresAt: new Date(maintenant.getTime() + 30 * JOURS_MS),
    });
  }

  return candidats;
}

// ANOMALIE_FINANCIERE — Admin UNIQUEMENT (jamais Client, mandat section 13 :
// "ne pas exposer les informations financières internes sensibles aux
// mauvais profils" — une anomalie est un signal d'audit interne, jamais une
// information client). Réutilise detecterAnomalies() (V2.2-E) tel quel,
// jamais une seconde logique de détection.
export function genererCandidatAnomalie(facture: FactureAvecPaiements): AttentionCandidat | null {
  const anomalies = detecterAnomalies(facture);
  if (anomalies.length === 0) return null;
  return {
    type: "ANOMALIE_FINANCIERE",
    categorie: "ALERTE",
    priorite: "P0_CRITIQUE",
    titre: `Facture ${facture.numeroFacture} — anomalie détectée`,
    resume: `${anomalies.length} anomalie${anomalies.length > 1 ? "s" : ""} détectée${anomalies.length > 1 ? "s" : ""} : ${resumerAnomalies(anomalies)}.`,
    raison: "Un invariant financier attendu n'est pas respecté sur cette facture.",
    source: "Facture",
    sourceId: facture.id,
    recipientType: "ADMIN",
    recipientId: null,
    actionDisponible: { label: "Voir la facture", href: "/admin/factures" },
    metadata: { anomalies },
    expiresAt: null,
  };
}

function resumerAnomalies(anomalies: AnomalieFacture[]): string {
  return anomalies.map((a) => a.type).join(", ");
}

// Ordre d'affichage (mandat section 18, design cognitif : "CE QUI COMPTE
// avant TOUT CE QUI EXISTE" ; section 12 : priorité explicite
// ACTION_REQUISE > ALERTE > INFORMATION > RECOMMANDATION). Fonction pure,
// jamais un ORDER BY d'enum Postgres implicite (fragile, dépendant de
// l'ordre de déclaration) — le classement reste lisible et testable ici.
const ORDRE_CATEGORIE: Record<AttentionCategorie, number> = {
  ACTION_REQUISE: 0,
  ALERTE: 1,
  INFORMATION: 2,
  RECOMMANDATION: 3,
};
const ORDRE_PRIORITE: Record<AttentionPriorite, number> = {
  P0_CRITIQUE: 0,
  P1_HAUTE: 1,
  P2_NORMALE: 2,
  P3_BASSE: 3,
};

export function comparerAttentions(
  a: { categorie: AttentionCategorie; priorite: AttentionPriorite; createdAt: Date },
  b: { categorie: AttentionCategorie; priorite: AttentionPriorite; createdAt: Date }
): number {
  if (ORDRE_CATEGORIE[a.categorie] !== ORDRE_CATEGORIE[b.categorie]) {
    return ORDRE_CATEGORIE[a.categorie] - ORDRE_CATEGORIE[b.categorie];
  }
  if (ORDRE_PRIORITE[a.priorite] !== ORDRE_PRIORITE[b.priorite]) {
    return ORDRE_PRIORITE[a.priorite] - ORDRE_PRIORITE[b.priorite];
  }
  return b.createdAt.getTime() - a.createdAt.getTime();
}

// MESSAGE_NON_LU — V2.5 : Communication Intelligence (Lot 2, 21/09/2026).
//
// Agrégée par THREAD (règle #9 du mandat), jamais une Attention par
// Message individuel : un seul candidat par (clientId, lecteur), quel que
// soit le nombre de messages non lus. `nonLu` est un booléen d'EXISTENCE
// (au moins un message non lu), jamais un compte exact — le compte exact
// utile à l'UI (badge, Lot 5) reste calculé à la demande, scopé à UN seul
// lecteur, par lib/message-lecture.ts::compterMessagesNonLus ; le repro-
// duire ici pour chaque (client, lecteur) du dépôt entier exigerait une
// requête par paire, ce que la synchronisation globale (voir
// lib/attention/synchronisation.ts) s'interdit explicitement.
//
// sourceId distingue déjà le lecteur : `clientId` seul pour le Client
// (règle #10, cas à un seul lecteur), `"${clientId}:${adminUserId}"` pour
// un Admin (règle #7, lecture individuelle — l'extension minimale de la
// règle #10 nécessaire pour ne jamais modifier la contrainte
// @@unique([type, source, sourceId]) héritée d'Attention, qui est globale
// et non scopée par recipientId).
export type CandidatMessageParams = {
  clientId: string;
  recipientType: AttentionDestinataireType;
  recipientId: string; // clientId (Client) ou User.id de l'Admin (jamais null — l'individualité est toujours explicite)
  nonLu: boolean;
};

export function genererCandidatMessage(params: CandidatMessageParams): AttentionCandidat | null {
  if (!params.nonLu) return null;
  const sourceId = params.recipientType === "CLIENT" ? params.clientId : `${params.clientId}:${params.recipientId}`;
  return {
    type: "MESSAGE_NON_LU",
    categorie: "ACTION_REQUISE",
    priorite: "P2_NORMALE",
    titre: "Nouveaux messages non lus",
    resume: "Des messages n'ont pas encore été lus sur ce fil de conversation.",
    raison: "Un message a été envoyé sur ce fil depuis la dernière lecture.",
    source: "Message",
    sourceId,
    recipientType: params.recipientType,
    recipientId: params.recipientType === "CLIENT" ? params.clientId : params.recipientId,
    actionDisponible: {
      label: "Voir la conversation",
      href: params.recipientType === "CLIENT" ? "/client/communication" : `/admin/clients/${params.clientId}/messages`,
    },
    metadata: null,
    expiresAt: null,
  };
}

// BESOIN_A_CLARIFIER — mandat section 10 ("besoin nécessitant clarification")
// et section 11 implicite (2e domaine, prouve que le modèle Attention est
// générique). Client uniquement — le besoin appartient à son auteur.
export function genererCandidatBesoin(besoin: ClientNeed): AttentionCandidat | null {
  if (besoin.statut !== "A_CLARIFIER") return null;
  return {
    type: "BESOIN_A_CLARIFIER",
    categorie: "ACTION_REQUISE",
    priorite: "P1_HAUTE",
    titre: besoin.titre ? `Besoin "${besoin.titre}" à clarifier` : "Un besoin nécessite une clarification",
    resume: "Des informations complémentaires sont nécessaires pour traiter ce besoin.",
    raison: "L'analyse de ce besoin a détecté une incohérence ou une information manquante.",
    source: "ClientNeed",
    sourceId: besoin.id,
    recipientType: "CLIENT",
    recipientId: besoin.clientId,
    actionDisponible: { label: "Clarifier le besoin", href: "/client/besoins" },
    metadata: null,
    expiresAt: null,
  };
}
