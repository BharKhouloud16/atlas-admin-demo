import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// COMPANY ATLAS — DB-09 : Capability UI (08/10/2026).
//
// Détail d'une CapabilityRequirement (A8) + Missions réellement liées via
// MissionCapabilityLink (A21) — aucune relation recalculée, uniquement les
// lignes MissionCapabilityLink déjà persistées pour cette
// capabilityRequirementId (contrat A21 : "ne recalculer aucun lien côté
// frontend", mandat DB-09 §8). Vue ADMIN transverse, même restriction que
// GET /api/capabilities (voir route.ts du dossier parent) et que
// GET /api/missions/[id]/capability-links (A21 §14) : aucun accès
// INGENIEUR/CLIENT introduit par ce lot.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const capability = await prisma.capabilityRequirement.findUnique({
    where: { id: params.id },
    include: {
      need: { select: { id: true, texteOriginal: true, client: { select: { nom: true } } } },
      missionLinks: {
        orderBy: { createdAt: "asc" },
        include: { mission: { select: { id: true, repere: true, statut: true } } },
      },
    },
  });

  if (!capability) {
    return NextResponse.json({ error: "Capability introuvable" }, { status: 404 });
  }

  return NextResponse.json({
    id: capability.id,
    needVersionId: capability.needVersionId,
    needTexte: capability.need.texteOriginal,
    clientNom: capability.need.client.nom,
    solutionDecisionId: capability.solutionDecisionId,
    sourceFaitId: capability.sourceFaitId,
    requiredCapability: capability.requiredCapability,
    rationale: capability.rationale,
    provenance: capability.provenance,
    status: capability.status,
    createdAt: capability.createdAt,
    missionLinks: capability.missionLinks.map((l) => ({
      id: l.id,
      missionId: l.missionId,
      missionRepere: l.mission.repere,
      missionStatut: l.mission.statut,
      capability: l.capability,
      rationale: l.rationale,
      statut: l.statut,
      createdAt: l.createdAt,
      createdByEmail: l.createdByEmail,
    })),
  });
}
