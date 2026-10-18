import { prisma } from "@/lib/prisma";
import type { SignalResultat } from "./classification";

// COMPANY ATLAS — A34 : Learning Loop Runtime (06/10/2026).
//
// A35.3-FIX (contrat A35 F4, audit A35) : la comparabilité est désormais
// fondée EXCLUSIVEMENT sur la nature réelle du travail (Capability, via
// MissionCapabilityLink, A21 — seule dimension structurée réellement
// disponible, "Domain" n'existe comme champ nulle part dans le schéma
// ATLAS aujourd'hui, jamais inventé ici). Le "OU clientId" précédent est
// supprimé : un Client commun seul ne fonde plus jamais une récidive
// (même Client + Capability différente -> NON comparable), et un Client
// différent avec la même Capability EST comparable (la récidive cherche
// une répétition dans la nature du travail, jamais un simple regroupement
// par portefeuille client) — Capability est la condition de comparabilité,
// Client n'est plus un critère de filtrage ici.
//
// AUCUN embedding, AUCUNE vector database, AUCUNE similarité décidée par
// une IA — toujours déterministe (contrat A34 §10, inchangé par F4).
//
// Une Mission comparable doit elle-même porter un signal jugé (Outcome
// courant, FinancialResult, ou Quality Gate FINALIZED) — jamais une simple
// co-présence de WorkItems (signal trop faible, contrat A34 §7, inchangé).
//
// A35.3-FIX (F4 §7/§8) : une Mission comparable dont le signal contredit
// DIRECTEMENT celui recherché (Outcome/FinancialResult de sens opposé,
// OBTENU/NON_OBTENU ou PROFIT/LOSS) n'est JAMAIS comptée comme récidive
// positive — mais elle n'est ni supprimée, ni modifiée, ni source d'une
// quelconque auto-supersession ou désignation de "vainqueur" (contrat A34
// §12, même doctrine que la détection de contradiction Learning-à-Learning
// de contradictions.ts, jamais réécrite ici). Une Mission comparable sans
// signal directionnel exploitable (Outcome/FinancialResult absents, seule
// une QualityGate FINALIZED existe) n'est ni positive ni contradictoire
// par construction — faute de direction comparable, elle reste comptée
// comme support (comportement historique préservé pour ce seul cas, aucune
// nouvelle notion de "neutralité" inventée).
//
// Seuil VERROUILLÉ (contrat A34 §10) : ne retourne jamais un compte "la
// Mission elle-même + elle-même" — uniquement les AUTRES Missions
// comparables, TERMINEE, distinctes de missionId.

export type RecidiveResultat = {
  // Missions comparables (même Capability) portant un signal qui CONCORDE
  // avec le signal recherché, ou dont le signal n'a pas de direction
  // comparable (QualityGate seule) — seul ce compte alimente la récidive
  // positive consommée par determinerType()/determinerConfidence().
  count: number;
  // Missions comparables (même Capability) portant un signal DIRECTEMENT
  // opposé au signal recherché — jamais comptées positivement, disponibles
  // pour un usage futur (ex. F5), jamais exploitées ici au-delà de ce
  // compte.
  contradictoires: number;
};

// Même précédence que classification.ts::deriverSignalResultat (Outcome
// d'abord, puis FinancialResult) — dupliquée ici volontairement en local :
// deriverSignalResultat attend un DossierFaits complet (construit par
// construireDossierFaits, coûteux), alors qu'ici seul un sous-ensemble
// minimal de champs est déjà chargé par Mission candidate. Même règle,
// jamais une nouvelle sémantique.
function signalDirectionnel(c: {
  outcomeAssessments: { overallStatus: string }[];
  financialResults: { resultatGlobal: string }[];
}): boolean | null {
  if (c.outcomeAssessments.length > 0) {
    const statut = c.outcomeAssessments[0].overallStatus;
    if (statut === "OBTENU") return true;
    if (statut === "NON_OBTENU") return false;
  }
  if (c.financialResults.length > 0) {
    const resultat = c.financialResults[0].resultatGlobal;
    if (resultat === "PROFIT") return true;
    if (resultat === "LOSS") return false;
  }
  return null;
}

export async function compterMissionsComparables(missionId: string, signalRecherche: SignalResultat): Promise<RecidiveResultat> {
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    select: { id: true },
  });
  if (!mission) return { count: 0, contradictoires: 0 };

  const liensCapability = await prisma.missionCapabilityLink.findMany({
    where: { missionId, statut: "ACTIVE" },
    select: { capability: true },
  });
  const capabilities = [...new Set(liensCapability.map((l) => l.capability))];

  // Aucune Capability sur la Mission courante -> structurellement aucune
  // Mission ne peut en partager une : NON COMPARABLE par construction
  // (évite également un OR Prisma vide).
  if (capabilities.length === 0) return { count: 0, contradictoires: 0 };

  const candidats = await prisma.mission.findMany({
    where: {
      id: { not: missionId },
      statut: "TERMINEE",
      capabilityLinks: { some: { statut: "ACTIVE", capability: { in: capabilities } } },
    },
    select: {
      id: true,
      outcomeAssessments: { where: { supersededBy: null }, select: { overallStatus: true }, take: 1 },
      financialResults: { select: { resultatGlobal: true }, take: 1 },
      deliverables: {
        select: { versions: { where: { supersededBy: null }, select: { qualityGates: { where: { statut: "FINALIZED" }, select: { id: true }, take: 1 } } } },
      },
    },
  });

  let count = 0;
  let contradictoires = 0;
  for (const c of candidats) {
    const aUneQualityFinalisee = c.deliverables.some((d) => d.versions.some((v) => v.qualityGates.length > 0));
    const aUnSignalExploitable = c.outcomeAssessments.length > 0 || c.financialResults.length > 0 || aUneQualityFinalisee;
    if (!aUnSignalExploitable) continue; // ignorée pour la récidive (ni positive ni contradictoire)

    const direction = signalDirectionnel(c);
    if (signalRecherche.positif !== null && direction !== null && direction !== signalRecherche.positif) {
      contradictoires += 1; // jamais comptée positivement — jamais supprimée/modifiée
    } else {
      count += 1;
    }
  }
  return { count, contradictoires };
}
