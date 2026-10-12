import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// COMPANY ATLAS — DB-09 : Capability UI (08/10/2026).
//
// SEUL ajout backend de ce lot (lecture seule, additif, aucune migration,
// aucun nouveau modèle) : aucune route transverse ne liste aujourd'hui les
// CapabilityRequirement (A8) à travers TOUS les Need — l'unique route
// existante (GET /api/talent/besoins/[id]/capabilities) reste scopée à un
// seul besoin. Même patron exact que DB-06 (GET /api/agentic-runs) : un
// simple findMany() Admin-only sur un modèle déjà existant, aucune
// logique métier nouvelle, aucune dérivation déclenchée ici (contrairement
// à GET /api/client/besoins/[id]/capabilities — cette route-ci ne fait
// jamais appel à lib/capability/engine.ts, uniquement une lecture).
//
// RBAC (contrat A8/A21, vérifié dans lib/capability/service.ts et
// lib/mission/capability-link.ts avant d'écrire cette route) : réservé
// ADMIN, même restriction que /api/missions/[id]/capability-links (A21
// §14) et que la vue transverse /api/talent/besoins/[id]/capabilities —
// aucun nouveau droit introduit pour INGENIEUR/CLIENT/Agent.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const statut = searchParams.get("statut") ?? undefined;
  const limiteBrute = Number(searchParams.get("limite"));
  const limite = Number.isFinite(limiteBrute) && limiteBrute > 0 ? Math.min(limiteBrute, 200) : 100;

  const capabilities = await prisma.capabilityRequirement.findMany({
    where: statut ? { status: statut as never } : {},
    orderBy: { createdAt: "desc" },
    take: limite,
    include: {
      need: { select: { id: true, texteOriginal: true, client: { select: { nom: true } } } },
      missionLinks: { select: { id: true } },
    },
  });

  return NextResponse.json({
    capabilities: capabilities.map((c) => ({
      id: c.id,
      needVersionId: c.needVersionId,
      needTexte: c.need.texteOriginal,
      clientNom: c.need.client.nom,
      sourceFaitId: c.sourceFaitId,
      requiredCapability: c.requiredCapability,
      rationale: c.rationale,
      provenance: c.provenance,
      status: c.status,
      createdAt: c.createdAt,
      nombreMissionsLiees: c.missionLinks.length,
    })),
  });
}
