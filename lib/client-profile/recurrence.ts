// COMPANY ATLAS — LOT 4 : Profil Client Intelligence Foundation (15/09/2026).
//
// Fonction PURE, aucun accès Prisma, aucun appel IA : détecte une
// récurrence déterministe à travers plusieurs ClientNeed DISTINCTS du même
// client (jamais deux occurrences dans le même besoin — voir needId).
// Produit un SIGNAL uniquement, jamais un fait confirmé automatiquement
// (directive CEO LOT 4 : "SIGNAL != FAIT CONFIRMÉ"). Seule une action
// explicite du client ("Enregistrer dans mon profil") transforme un signal
// en ClientProfileFact (BESOIN_RECURRENT_CONFIRME, statut DECLARE) — voir
// app/api/client/profil/faits/route.ts.

import { normaliserValeur } from "./faits";

// Clés jugées porteuses de sens récurrent — BUDGET_MONTANT/dates
// explicitement exclues (trop variables pour signifier une préférence
// durable, voir architecture validée Phase 2).
export const CLES_CONSIDEREES_POUR_RECURRENCE = ["ROLE", "COMPETENCE", "SENIORITE", "LOCALISATION", "REMOTE"];

const SEUIL_OCCURRENCES = 2;

export type FaitBesoinPourRecurrence = { cle: string; valeur: string; needId: string };

export type SignalRecurrence = {
  cle: string;
  valeur: string;
  occurrences: number;
  needIds: string[];
};

export function detecterRecurrences(faits: FaitBesoinPourRecurrence[]): SignalRecurrence[] {
  const groupes = new Map<string, { cle: string; valeur: string; needIds: Set<string> }>();

  for (const fait of faits) {
    if (!CLES_CONSIDEREES_POUR_RECURRENCE.includes(fait.cle)) continue;
    const cleGroupe = `${fait.cle}::${normaliserValeur(fait.valeur)}`;
    const existant = groupes.get(cleGroupe);
    if (existant) {
      existant.needIds.add(fait.needId);
    } else {
      groupes.set(cleGroupe, { cle: fait.cle, valeur: fait.valeur, needIds: new Set([fait.needId]) });
    }
  }

  const signaux: SignalRecurrence[] = [];
  for (const groupe of groupes.values()) {
    if (groupe.needIds.size >= SEUIL_OCCURRENCES) {
      signaux.push({
        cle: groupe.cle,
        valeur: groupe.valeur,
        occurrences: groupe.needIds.size,
        needIds: [...groupe.needIds],
      });
    }
  }

  return signaux.sort((a, b) => b.occurrences - a.occurrences);
}
