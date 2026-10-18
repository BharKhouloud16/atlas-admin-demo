import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { lireDeliverable, modifierDeliverableAvecRetry, DeliverableIntrouvableError } from "@/lib/deliverable/deliverable";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A25 : Deliverable Foundation (05/10/2026).
//
// PATCH édite UNIQUEMENT acceptanceCriteria (contrat A25 §27/§39 : le
// seul champ métier qui vit sur Deliverable lui-même) — jamais titre/
// natureContenu/contenuStructure ici (vivent sur DeliverableVersion,
// immuables, voir .../versions). Même périmètre RBAC que la route parente.
async function missionAutorisee(missionId: string, role: string, profilId: string | null): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (role !== "INGENIEUR") return false;
  const mission = await prisma.mission.findUnique({ where: { id: missionId }, select: { profilId: true } });
  return !!mission && mission.profilId === profilId;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string; deliverableId: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR")) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  if (!(await missionAutorisee(params.id, session.role, session.profilId ?? null))) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  try {
    const deliverable = await lireDeliverable({ deliverableId: params.deliverableId, missionId: params.id });
    return NextResponse.json(deliverable);
  } catch (erreur) {
    if (erreur instanceof DeliverableIntrouvableError) {
      return NextResponse.json({ error: "Deliverable introuvable" }, { status: 404 });
    }
    throw erreur;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; deliverableId: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR")) {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/deliverables/[deliverableId]",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Deliverable",
      ressourceId: params.deliverableId,
      detail: "Tentative de modification d'un Deliverable par un rôle non autorisé.",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  if (!(await missionAutorisee(params.id, session.role, session.profilId ?? null))) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.acceptanceCriteria === undefined) {
    return NextResponse.json({ error: "Aucun champ modifiable fourni (acceptanceCriteria)." }, { status: 400 });
  }
  if (body.acceptanceCriteria !== null && typeof body.acceptanceCriteria !== "string") {
    return NextResponse.json({ error: "acceptanceCriteria doit être une chaîne ou null." }, { status: 400 });
  }

  try {
    const deliverable = await modifierDeliverableAvecRetry({
      deliverableId: params.deliverableId,
      missionId: params.id,
      acceptanceCriteria: body.acceptanceCriteria,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: session.role,
      action: "deliverable.updated",
      cible: `mission:${params.id}`,
      detail: `Deliverable ${deliverable.id} : acceptanceCriteria modifié.`,
    });

    return NextResponse.json(deliverable);
  } catch (erreur) {
    if (erreur instanceof DeliverableIntrouvableError) {
      return NextResponse.json({ error: "Deliverable introuvable" }, { status: 404 });
    }
    throw erreur;
  }
}
