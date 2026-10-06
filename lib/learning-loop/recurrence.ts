import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A34 : Learning Loop Runtime (06/10/2026).
//
// Récidive DÉTERMINISTE (contrat A34 §10) — AUCUN embedding, AUCUNE
// vector database, AUCUNE similarité décidée par une IA. Deux Missions
// sont "comparables" si elles partagent le même Client OU la même
// Capability (via MissionCapabilityLink.capability, A21, seule dimension
// structurée réellement disponible — "Domain" n'existe comme champ nulle
// part dans le schéma ATLAS aujourd'hui, voir rapport final §21 : jamais
// inventé ici) ET que la Mission comparable porte elle-même un signal
// jugé (Outcome courant, FinancialResult, ou Quality Gate FINALIZED) —
// jamais une simple co-présence de WorkItems (signal trop faible pour
// fonder une récidive, contrat A34 §7).
//
// Seuil VERROUILLÉ (contrat A34 §10) : ne retourne jamais un compte "la
// Mission elle-même + elle-même" — uniquement les AUTRES Missions
// comparables, TERMINEE, distinctes de missionId.

export async function compterMissionsComparables(missionId: string): Promise<number> {
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    select: { id: true, clientId: true },
  });
  if (!mission) return 0;

  const liensCapability = await prisma.missionCapabilityLink.findMany({
    where: { missionId, statut: "ACTIVE" },
    select: { capability: true },
  });
  const capabilities = [...new Set(liensCapability.map((l) => l.capability))];

  const criteresOu: Prisma.MissionWhereInput[] = [{ clientId: mission.clientId }];
  if (capabilities.length > 0) {
    criteresOu.push({ capabilityLinks: { some: { statut: "ACTIVE", capability: { in: capabilities } } } });
  }

  const candidats = await prisma.mission.findMany({
    where: {
      id: { not: missionId },
      statut: "TERMINEE",
      OR: criteresOu,
    },
    select: {
      id: true,
      outcomeAssessments: { where: { supersededBy: null }, select: { id: true }, take: 1 },
      financialResults: { select: { id: true }, take: 1 },
      deliverables: {
        select: { versions: { where: { supersededBy: null }, select: { qualityGates: { where: { statut: "FINALIZED" }, select: { id: true }, take: 1 } } } },
      },
    },
  });

  let compte = 0;
  for (const c of candidats) {
    const aUneQualityFinalisee = c.deliverables.some((d) => d.versions.some((v) => v.qualityGates.length > 0));
    if (c.outcomeAssessments.length > 0 || c.financialResults.length > 0 || aUneQualityFinalisee) {
      compte += 1;
    }
  }
  return compte;
}
