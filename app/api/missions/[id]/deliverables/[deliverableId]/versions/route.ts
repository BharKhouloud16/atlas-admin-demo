import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { creerVersionAvecRetry, listerVersionsDeliverable } from "@/lib/deliverable/version";
import { DeliverableIntrouvableError, TitreInvalideError, ContenuStructureInvalideError } from "@/lib/deliverable/deliverable";
import type { DeliverableNatureContenu } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A25 : Deliverable Foundation (05/10/2026).
//
// AUCUNE vérification Mission.statut ici (contrat A25 §34/§35, décision
// explicite documentée dans lib/deliverable/version.ts) : une nouvelle
// version corrective reste toujours créable, y compris après Mission
// TERMINEE/ANNULEE. Même périmètre RBAC que la création de Deliverable.
const NATURES_VALIDES: DeliverableNatureContenu[] = ["DOCUMENT", "STRUCTURE", "OPERATION", "DECLARATIF"];

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

  const deliverable = await prisma.deliverable.findUnique({ where: { id: params.deliverableId }, select: { id: true, missionId: true } });
  if (!deliverable || deliverable.missionId !== params.id) {
    return NextResponse.json({ error: "Deliverable introuvable" }, { status: 404 });
  }

  const versions = await listerVersionsDeliverable(params.deliverableId);
  return NextResponse.json({ deliverableId: params.deliverableId, versions });
}

export async function POST(req: NextRequest, { params }: { params: { id: string; deliverableId: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR")) {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/deliverables/[deliverableId]/versions",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Deliverable",
      ressourceId: params.deliverableId,
      detail: "Tentative de création d'une DeliverableVersion par un rôle non autorisé.",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  if (!(await missionAutorisee(params.id, session.role, session.profilId ?? null))) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  const deliverable = await prisma.deliverable.findUnique({ where: { id: params.deliverableId }, select: { id: true, missionId: true } });
  if (!deliverable || deliverable.missionId !== params.id) {
    return NextResponse.json({ error: "Deliverable introuvable" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (typeof body?.titre !== "string" || body.titre.trim().length === 0) {
    return NextResponse.json({ error: "titre requis (non vide)." }, { status: 400 });
  }
  if (typeof body?.natureContenu !== "string" || !NATURES_VALIDES.includes(body.natureContenu as DeliverableNatureContenu)) {
    return NextResponse.json({ error: "natureContenu invalide (DOCUMENT, STRUCTURE, OPERATION ou DECLARATIF attendu)." }, { status: 400 });
  }

  try {
    const version = await creerVersionAvecRetry({
      deliverableId: params.deliverableId,
      titre: body.titre,
      natureContenu: body.natureContenu as DeliverableNatureContenu,
      contenuStructure: body.contenuStructure,
      createdByEmail: session.email,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: session.role,
      action: "deliverable.version.created",
      cible: `mission:${params.id}`,
      detail: `DeliverableVersion ${version.id} créée (Deliverable ${params.deliverableId}, version ${version.version}, supersède ${version.supersedesId ?? "aucune"}).`,
    });

    return NextResponse.json(version, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof DeliverableIntrouvableError) {
      return NextResponse.json({ error: "Deliverable introuvable" }, { status: 404 });
    }
    if (erreur instanceof TitreInvalideError) {
      return NextResponse.json({ error: "titre requis (non vide)." }, { status: 400 });
    }
    if (erreur instanceof ContenuStructureInvalideError) {
      return NextResponse.json({ error: "contenuStructure n'est accepté que si natureContenu = STRUCTURE." }, { status: 400 });
    }
    throw erreur;
  }
}
