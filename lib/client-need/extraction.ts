// COMPANY ATLAS — LOT 2 : Client Need Intelligence Foundation (15/09/2026).
//
// Wrapper fin autour de resoudreAiProvider().extraireBesoin() — même rôle
// que lib/talent/analyseur.ts pour DemandeTalent, mais générique (pas
// Talent-only). Ne modifie JAMAIS un ClientNeed lui-même : renvoie une
// suggestion que l'appelant (route API) applique explicitement.
import { resoudreAiProvider, type SuggestionBesoin, type CleFaitBesoinExtractible } from "@/lib/ai/provider";
import { TOUTES_COMPETENCES } from "@/lib/competences";
import { PAYS } from "@/lib/localisation";

export type ResultatExtractionBesoin = SuggestionBesoin & { provider: string };

export async function extraireBesoinClient(texteOriginal: string): Promise<ResultatExtractionBesoin> {
  const provider = resoudreAiProvider();
  const suggestion = await provider.extraireBesoin(texteOriginal, TOUTES_COMPETENCES, PAYS);
  return { ...suggestion, provider: provider.nom };
}

// Attributs jugés suffisamment importants pour la compréhension du besoin
// pour que leur ABSENCE soit rendue explicite (une ligne ClientNeedFait
// statut=INCONNU, valeur vide) plutôt que silencieuse — permet à l'UI de
// lister "informations à préciser" directement depuis les données, sans
// deviner. Les autres clés non détectées restent simplement absentes
// (aucune ligne) : ni l'un ni l'autre ne représente jamais une valeur
// inventée.
//
// A6.1 — Outcome Foundation (01/10/2026) : RESULTAT_ATTENDU rejoint cette
// liste — son absence devient une clarification RECOMMANDÉE (priorité
// MANQUANT, jamais bloquante pour VALIDATED, voir A6 §A6.9 Option B et le
// rapport final A6.1) au même titre que ROLE/SENIORITE/etc. ci-dessous.
// CRITERE_REUSSITE reste volontairement absent de cette liste : clé
// répétable, hors périmètre de la boucle de clarification CONFIRMER/
// CORRIGER par décision explicite LOT 3 (voir CLES_CLARIFIABLES,
// lib/client-need/clarification.ts) — ajouter ici produirait un
// "MANQUANT" sur une clé que le client ne pourrait jamais corriger via
// cette route, ce qui serait trompeur.
export const CLES_IMPORTANTES_SI_ABSENTES: CleFaitBesoinExtractible[] = [
  "ROLE",
  "SENIORITE",
  "BUDGET_MONTANT",
  "LOCALISATION",
  "DISPONIBILITE",
  "DUREE",
  "RESULTAT_ATTENDU",
];
