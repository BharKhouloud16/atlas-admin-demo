import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  creerDeliverableAvecRetry,
  listerDeliverablesMission,
  MissionIntrouvableError,
  MissionFermeeError,
  TitreInvalideError,
  ContenuStructureInvalideError,
} from "@/lib/deliverable/deliverable";
import type { DeliverableNatureContenu } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A25 : Deliverable Foundation (05/10/2026).
//
// RBAC (contrat A25 §45, audité) : ADMIN sans restriction. INGENIEUR peut
// préparer/créer sur sa PROPRE Mission uniquement (mission.profilId ===
// session.profilId — même convention que .../skill-proposals, Phase
// 2B-1) : "introuvable" (jamais 403) si la Mission appartient à un autre
// Ingénieur, même doctrine IDOR. CLIENT : aucun accès (validation Client
// explicitement différée, contrat A25 §19/§45). Aucun rôle Agent.
const NATURES_VALIDES: DeliverableNatureContenu[] = ["DOCUMENT", "STRUCTURE", "OPERATION", "DECLARATIF"];

async function missionAutorisee(missionId: string, role: string, profilId: string | null): Promise<"ADMIN" | "INGENIEUR" | null> {
  if (role === "ADMIN") return "ADMIN";
  if (role !== "INGENIEUR") return null;
  const mission = await prisma.mission.findUnique({ where: { id: missionId }, select: { profilId: true } });
  if (!mission || mission.profilId !== profilId) return null;
  return "INGENIEUR";
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR")) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const acces = await missionAutorisee(params.id, session.role, session.profilId ?? null);
  if (!acces) {
    // Jamais 403 pour un Ingénieur sur la Mission d'un autre (IDOR) :
    // même traitement "Mission introuvable" qu'une Mission réellement
    // inexistante.
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  const deliverables = await listerDeliverablesMission(params.id);
  return NextResponse.json({ missionId: params.id, deliverables });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR")) {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/deliverables",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Mission",
      ressourceId: params.id,
      detail: "Tentative de création d'un Deliverable par un rôle non autorisé.",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const acces = await missionAutorisee(params.id, session.role, session.profilId ?? null);
  if (!acces) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);

  if (typeof body?.titre !== "string" || body.titre.trim().length === 0) {
    return NextResponse.json({ error: "titre requis (non vide)." }, { status: 400 });
  }
  if (typeof body?.natureContenu !== "string" || !NATURES_VALIDES.includes(body.natureContenu as DeliverableNatureContenu)) {
    return NextResponse.json({ error: "natureContenu invalide (DOCUMENT, STRUCTURE, OPERATION ou DECLARATIF attendu)." }, { status: 400 });
  }
  if (body?.acceptanceCriteria !== undefined && body.acceptanceCriteria !== null && typeof body.acceptanceCriteria !== "string") {
    return NextResponse.json({ error: "acceptanceCriteria doit être une chaîne ou null." }, { status: 400 });
  }

  try {
    const deliverable = await creerDeliverableAvecRetry({
      missionId: params.id,
      titre: body.titre,
      natureContenu: body.natureContenu as DeliverableNatureContenu,
      acceptanceCriteria: body.acceptanceCriteria ?? null,
      contenuStructure: body.contenuStructure,
      createdByEmail: session.email,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: session.role,
      action: "deliverable.created",
      cible: `mission:${params.id}`,
      detail: `Deliverable ${deliverable.id} créé avec sa version 1 ("${deliverable.versions[0]?.titre}").`,
    });

    return NextResponse.json(deliverable, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof MissionIntrouvableError) {
      return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
    }
    if (erreur instanceof MissionFermeeError) {
      return NextResponse.json({ error: "Impossible de créer un Deliverable sur une Mission TERMINEE ou ANNULEE." }, { status: 409 });
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
