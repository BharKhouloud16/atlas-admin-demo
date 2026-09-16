import { createHash } from "crypto";
import type { SuggestionCriteresDemande } from "@/lib/client-need/talent-bridge";

// COMPANY ATLAS — V2.1-C : C3 Solution Intelligence — détection de
// changement de source, pour l'idempotence de la génération.
//
// Fonction pure : un hachage déterministe (crypto.createHash, jamais
// Math.random/Date.now) des critères ACTUELLEMENT résolus du ClientNeed
// (suggererCriteresDemande(), LOT 5, réutilisée telle quelle — jamais une
// deuxième lecture des ClientNeedFait). Même besoin + mêmes critères
// résolus = même signature = pas de nouvelle génération. Un seul champ
// changé (nouvelle compétence, budget corrigé...) = signature différente =
// nouvelle vague de SolutionOption, append-only (jamais un écrasement des
// lignes précédentes).
export function calculerSignatureSource(criteres: SuggestionCriteresDemande): string {
  const elements = [
    [...criteres.competencesExtraites.map((c) => c.valeur)].sort().join("|"),
    criteres.senioriteSouhaitee?.valeur ?? "",
    criteres.anneesExperienceMin?.valeur ?? "",
    criteres.localisation?.valeur ?? "",
    criteres.disponibiliteSouhaitee?.valeur ?? "",
    criteres.budgetTjmMax?.valeur ?? "",
    criteres.budgetDevise?.valeur ?? "",
    criteres.dateDebutSouhaitee?.valeur ?? "",
  ];
  return createHash("sha256").update(elements.join("::")).digest("hex");
}
