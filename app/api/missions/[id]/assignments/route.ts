import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  creerAssignmentAvecRetry,
  listerAssignmentsMission,
  MissionIntrouvableError,
  TalentIntrouvableError,
  AllocationInvalideError,
  StatutInitialInvalideError,
  ResponsablePrincipalDejaPresentError,
  TalentDejaActifError,
} from "@/lib/mission/assignment";
import type { MissionAssignmentRole, MissionAssignmentStatut } from "@prisma/client";

// COMPANY ATLAS — A20 : MissionAssignment Foundation (05/10/2026).
//
// Réservé ADMIN (contrat A20 §10) : ni le Client, ni l'Ingénieur ne peuvent
// créer/modifier une MissionAssignment dans ce lot — l'Ingénieur pourra
// seulement la CONSOMMER (lecture) dans un lot futur, jamais dans A20.
// Mission.profilId reste le legacy inchangé (voir prisma/schema.prisma) ;
// cette route ne le lit ni ne l'écrit jamais.
const ROLES_VALIDES: MissionAssignmentRole[] = ["RESPONSABLE_PRINCIPAL", "CONTRIBUTEUR", "REVIEWER"];
const STATUTS_CREATION_VALIDES: MissionAssignmentStatut[] = ["PLANIFIE", "ACTIF"];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!mission) return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });

  const assignments = await listerAssignmentsMission(params.id);
  return NextResponse.json({ missionId: params.id, assignments });
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
      contexteRoute: "/api/missions/[id]/assignments",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Mission",
      ressourceId: params.id,
      detail: "Tentative de création d'une MissionAssignment par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);

  if (typeof body?.talentId !== "string" || body.talentId.trim().length === 0) {
    return NextResponse.json({ error: "talentId requis." }, { status: 400 });
  }
  if (typeof body?.role !== "string" || !ROLES_VALIDES.includes(body.role as MissionAssignmentRole)) {
    return NextResponse.json({ error: "role invalide (RESPONSABLE_PRINCIPAL, CONTRIBUTEUR ou REVIEWER)." }, { status: 400 });
  }
  if (typeof body?.dateDebut !== "string") {
    return NextResponse.json({ error: "dateDebut requis." }, { status: 400 });
  }
  const dateDebut = new Date(body.dateDebut);
  if (Number.isNaN(dateDebut.getTime())) {
    return NextResponse.json({ error: "dateDebut invalide." }, { status: 400 });
  }

  let statut: MissionAssignmentStatut | undefined;
  if (body.statut !== undefined) {
    if (typeof body.statut !== "string" || !STATUTS_CREATION_VALIDES.includes(body.statut as MissionAssignmentStatut)) {
      return NextResponse.json({ error: "statut invalide à la création (PLANIFIE ou ACTIF uniquement)." }, { status: 400 });
    }
    statut = body.statut as MissionAssignmentStatut;
  }

  let allocationPct: number | null | undefined;
  if (body.allocationPct !== undefined) {
    if (body.allocationPct !== null && typeof body.allocationPct !== "number") {
      return NextResponse.json({ error: "allocationPct doit être un nombre ou null." }, { status: 400 });
    }
    allocationPct = body.allocationPct;
  }

  const estResponsablePrincipal = body.estResponsablePrincipal === true;

  try {
    const assignment = await creerAssignmentAvecRetry({
      missionId: params.id,
      talentId: body.talentId,
      role: body.role as MissionAssignmentRole,
      statut,
      dateDebut,
      allocationPct,
      estResponsablePrincipal,
      createdByEmail: session.email,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "mission.assignment.created",
      cible: `mission:${params.id}`,
      detail: `MissionAssignment ${assignment.id} créée (talent ${assignment.talentId}, rôle ${assignment.role}, statut ${assignment.statut}).`,
    });

    return NextResponse.json(assignment, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof MissionIntrouvableError) {
      return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
    }
    if (erreur instanceof TalentIntrouvableError) {
      return NextResponse.json({ error: "Talent introuvable" }, { status: 404 });
    }
    if (erreur instanceof AllocationInvalideError) {
      return NextResponse.json({ error: "allocationPct doit être un entier entre 0 et 100, ou null." }, { status: 400 });
    }
    if (erreur instanceof StatutInitialInvalideError) {
      return NextResponse.json({ error: "statut initial invalide." }, { status: 400 });
    }
    if (erreur instanceof ResponsablePrincipalDejaPresentError) {
      return NextResponse.json({ error: "Cette Mission a déjà un responsable principal actif." }, { status: 409 });
    }
    if (erreur instanceof TalentDejaActifError) {
      return NextResponse.json({ error: "Ce Talent a déjà une affectation active sur cette Mission." }, { status: 409 });
    }
    throw erreur;
  }
}
