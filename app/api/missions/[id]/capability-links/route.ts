import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  creerLienAvecRetry,
  lireLiensMission,
  MissionIntrouvableError,
  CapabilityRequirementIntrouvableError,
  NeedVersionIncoherenteError,
  SolutionDecisionIncoherenteError,
  CapaciteManuelleManquanteError,
  LienDejaActifError,
} from "@/lib/mission/capability-link";

// COMPANY ATLAS — A21 : MissionCapabilityLink (05/10/2026).
//
// Réservé ADMIN (contrat A21 §14) : ni le Client, ni l'Ingénieur ne
// peuvent créer/consulter un lien capacité<->Mission dans ce lot — même
// restriction que MissionAssignment (A20), aucun nouveau droit de
// consommation introduit pour ces rôles. Aucune route Agent.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!mission) return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });

  const links = await lireLiensMission(params.id);
  return NextResponse.json({ missionId: params.id, links });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/capability-links",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Mission",
      ressourceId: params.id,
      detail: "Tentative de création d'un MissionCapabilityLink par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const rationale = typeof body?.rationale === "string" && body.rationale.trim().length > 0 ? body.rationale.trim().slice(0, 1000) : null;

  const capabilityRequirementId = typeof body?.capabilityRequirementId === "string" && body.capabilityRequirementId.trim().length > 0
    ? body.capabilityRequirementId
    : null;

  try {
    let link;
    if (capabilityRequirementId) {
      link = await creerLienAvecRetry({ missionId: params.id, capabilityRequirementId, rationale, createdByEmail: session.email });
    } else {
      if (typeof body?.capability !== "string" || body.capability.trim().length === 0) {
        return NextResponse.json({ error: "capability requis pour un lien manuel (sans capabilityRequirementId)." }, { status: 400 });
      }
      link = await creerLienAvecRetry({ missionId: params.id, capability: body.capability.trim().slice(0, 300), rationale, createdByEmail: session.email });
    }

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "mission.capability_link.created",
      cible: `mission:${params.id}`,
      detail: `MissionCapabilityLink ${link.id} créé (capability="${link.capability}", capabilityRequirementId=${link.capabilityRequirementId ?? "manuel"}).`,
    });

    return NextResponse.json(link, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof MissionIntrouvableError) {
      return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
    }
    if (erreur instanceof CapabilityRequirementIntrouvableError) {
      return NextResponse.json({ error: "CapabilityRequirement introuvable" }, { status: 404 });
    }
    if (erreur instanceof NeedVersionIncoherenteError) {
      return NextResponse.json(
        { error: "La CapabilityRequirement référencée ne provient pas de la version du Need pinnée sur cette Mission (ou la Mission n'a aucun needVersionId)." },
        { status: 409 }
      );
    }
    if (erreur instanceof SolutionDecisionIncoherenteError) {
      return NextResponse.json({ error: "La CapabilityRequirement référencée provient d'une autre SolutionDecision que celle de la Mission." }, { status: 409 });
    }
    if (erreur instanceof CapaciteManuelleManquanteError) {
      return NextResponse.json({ error: "capability requis et non vide pour un lien manuel." }, { status: 400 });
    }
    if (erreur instanceof LienDejaActifError) {
      return NextResponse.json({ error: "Un lien ACTIF existe déjà pour cette Mission et cette capacité." }, { status: 409 });
    }
    throw erreur;
  }
}
