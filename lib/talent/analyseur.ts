// AI Request Analyzer — transforme le texte libre d'une DemandeTalent
// (saisi par le Client) en critères structurés exploitables par le Matching
// Engine (lib/talent/matching.ts). Délègue l'extraction au provider IA actif
// (lib/ai/provider.ts, "local" par défaut, sans clé API requise) : ce
// fichier ne connaît pas le détail du provider, seulement la forme du
// résultat — pour pouvoir brancher Claude/OpenAI/Gemini plus tard sans
// changer les appelants (voir app/api/talent/demandes/[id]/route.ts).
import { resoudreAiProvider, type SuggestionAnalyse } from "@/lib/ai/provider";
import { TOUTES_COMPETENCES } from "@/lib/competences";

export type ResultatAnalyse = SuggestionAnalyse & { provider: string };

// L'analyse ne modifie JAMAIS la DemandeTalent elle-même — elle renvoie une
// suggestion que l'appelant (route API) applique explicitement, pour garder
// la porte ouverte à une relecture/correction humaine avant tout matching
// (l'Admin peut toujours éditer competencesExtraites/senioriteSouhaitee
// manuellement après coup).
export async function analyserDemande(description: string): Promise<ResultatAnalyse> {
  const provider = resoudreAiProvider();
  const suggestion = await provider.analyserTexte(description, TOUTES_COMPETENCES);
  return { ...suggestion, provider: provider.nom };
}
