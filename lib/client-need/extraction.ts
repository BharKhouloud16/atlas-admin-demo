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
export const CLES_IMPORTANTES_SI_ABSENTES: CleFaitBesoinExtractible[] = [
  "ROLE",
  "SENIORITE",
  "BUDGET_MONTANT",
  "LOCALISATION",
  "DISPONIBILITE",
  "DUREE",
];
