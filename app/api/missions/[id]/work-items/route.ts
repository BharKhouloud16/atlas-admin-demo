import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { creerWorkItemAvecRetry, listerWorkItemsMission, MissionIntrouvableError, MissionFermeeError, TitreInvalideError } from "@/lib/work-item/lifecycle";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A23 : WorkItem Foundation (05/10/2026).
//
// Réservé ADMIN — même périmètre que .../assignments (A20) et
// .../capability-links (A21), les deux précédents directs les plus
// proches (entités internes à l'exécution de la Mission, jamais exposées
// en mutation au Client, jamais à l'Ingénieur dans leurs lots respectifs).
// Un WorkItem appartient à l'exécution interne de Mission (contrat A23
// §26) : aucun droit inventé au-delà de ce périmètre déjà établi.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!mission) return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });

  const workItems = await listerWorkItemsMission(params.id);
  return NextResponse.json({ missionId: params.id, workItems });
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
      contexteRoute: "/api/missions/[id]/work-items",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Mission",
      ressourceId: params.id,
      detail: "Tentative de création d'un WorkItem par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);

  if (typeof body?.titre !== "string" || body.titre.trim().length === 0) {
    return NextResponse.json({ error: "titre requis (non vide)." }, { status: 400 });
  }
  if (body?.description !== undefined && body.description !== null && typeof body.description !== "string") {
    return NextResponse.json({ error: "description doit être une chaîne ou null." }, { status: 400 });
  }

  try {
    const workItem = await creerWorkItemAvecRetry({
      missionId: params.id,
      titre: body.titre,
      description: body.description ?? null,
      createdByEmail: session.email,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "workitem.created",
      cible: `mission:${params.id}`,
      detail: `WorkItem ${workItem.id} créé ("${workItem.titre}").`,
    });

    return NextResponse.json(workItem, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof MissionIntrouvableError) {
      return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
    }
    if (erreur instanceof MissionFermeeError) {
      return NextResponse.json({ error: "Impossible de créer un WorkItem sur une Mission TERMINEE ou ANNULEE." }, { status: 409 });
    }
    if (erreur instanceof TitreInvalideError) {
      return NextResponse.json({ error: "titre requis (non vide)." }, { status: 400 });
    }
    throw erreur;
  }
}
