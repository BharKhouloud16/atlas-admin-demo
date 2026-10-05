import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { supersederLienAvecRetry, LienIntrouvableError, LienDejaSupersedeError } from "@/lib/mission/capability-link";

// COMPANY ATLAS — A21 : MissionCapabilityLink (05/10/2026).
//
// Whitelist stricte, même discipline que .../assignments/[assignmentId]/
// route.ts (A20) : une seule action possible, "retirer" (statut ACTIVE ->
// SUPERSEDED). Jamais une cascade automatique depuis CapabilityRequirement
// — un retrait est TOUJOURS une décision Admin explicite sur CE lien
// précis (contrat A21 §10).
const TRANSITIONS_AUTORISEES = new Set(["retirer"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string; linkId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/capability-links/[linkId]",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "MissionCapabilityLink",
      ressourceId: params.linkId,
      detail: "Tentative de modification d'un MissionCapabilityLink par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body?.action !== "string" || !TRANSITIONS_AUTORISEES.has(body.action)) {
    return NextResponse.json({ error: "action invalide (retirer attendu)." }, { status: 400 });
  }

  try {
    const link = await supersederLienAvecRetry({ linkId: params.linkId, missionId: params.id });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "mission.capability_link.superseded",
      cible: `mission:${params.id}`,
      detail: `MissionCapabilityLink ${link.id} retiré (statut -> SUPERSEDED).`,
    });

    return NextResponse.json(link, { status: 200 });
  } catch (erreur) {
    if (erreur instanceof LienIntrouvableError) {
      return NextResponse.json({ error: "MissionCapabilityLink introuvable" }, { status: 404 });
    }
    if (erreur instanceof LienDejaSupersedeError) {
      return NextResponse.json({ error: "Ce lien est déjà SUPERSEDED." }, { status: 409 });
    }
    throw erreur;
  }
}
