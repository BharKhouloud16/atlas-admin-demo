import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  terminerAssignmentAvecRetry,
  annulerAssignmentAvecRetry,
  modifierAssignmentAvecRetry,
  AssignmentIntrouvableError,
  AssignmentNonActifError,
  AssignmentDejaTerminaleError,
  DateIncoherenteError,
  AllocationInvalideError,
  ResponsablePrincipalDejaPresentError,
} from "@/lib/mission/assignment";

// COMPANY ATLAS — A20 : MissionAssignment Foundation (05/10/2026).
//
// Whitelist stricte, même discipline que app/api/missions/[id]/transition/
// route.ts : deux formes de body mutuellement exclusives, jamais une
// écriture arbitraire. `action` présent -> transition (terminer/annuler,
// dateFin exigée) ; `action` absent -> modification des deux SEULS champs
// mutables (allocationPct/estResponsablePrincipal), refusée si l'Assignment
// n'est plus ACTIF. missionId/talentId/role/createdAt/createdByEmail ne
// sont JAMAIS lus depuis le body ici, quelle que soit la forme — immuables
// par construction (lib/mission/assignment.ts ne les accepte même pas en
// paramètre pour ces deux opérations).
const TRANSITIONS_AUTORISEES = new Set(["terminer", "annuler"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string; assignmentId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/assignments/[assignmentId]",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "MissionAssignment",
      ressourceId: params.assignmentId,
      detail: "Tentative de modification d'une MissionAssignment par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  try {
    if (typeof body?.action === "string") {
      if (!TRANSITIONS_AUTORISEES.has(body.action)) {
        return NextResponse.json({ error: "action invalide (terminer ou annuler attendu)." }, { status: 400 });
      }
      if (typeof body.dateFin !== "string") {
        return NextResponse.json({ error: "dateFin requise pour terminer/annuler." }, { status: 400 });
      }
      const dateFin = new Date(body.dateFin);
      if (Number.isNaN(dateFin.getTime())) {
        return NextResponse.json({ error: "dateFin invalide." }, { status: 400 });
      }

      const executer = body.action === "terminer" ? terminerAssignmentAvecRetry : annulerAssignmentAvecRetry;
      const assignment = await executer({ assignmentId: params.assignmentId, missionId: params.id, dateFin });

      await journaliser({
        acteurEmail: session.email,
        acteurRole: "ADMIN",
        action: body.action === "terminer" ? "mission.assignment.terminee" : "mission.assignment.annulee",
        cible: `mission:${params.id}`,
        detail: `MissionAssignment ${assignment.id} -> ${assignment.statut}.`,
      });

      return NextResponse.json(assignment, { status: 200 });
    }

    const data: { allocationPct?: number | null; estResponsablePrincipal?: boolean } = {};
    if (body?.allocationPct !== undefined) {
      if (body.allocationPct !== null && typeof body.allocationPct !== "number") {
        return NextResponse.json({ error: "allocationPct doit être un nombre ou null." }, { status: 400 });
      }
      data.allocationPct = body.allocationPct;
    }
    if (body?.estResponsablePrincipal !== undefined) {
      if (typeof body.estResponsablePrincipal !== "boolean") {
        return NextResponse.json({ error: "estResponsablePrincipal doit être un booléen." }, { status: 400 });
      }
      data.estResponsablePrincipal = body.estResponsablePrincipal;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Aucun champ modifiable fourni (allocationPct, estResponsablePrincipal, ou action)." }, { status: 400 });
    }

    const assignment = await modifierAssignmentAvecRetry({
      assignmentId: params.assignmentId,
      missionId: params.id,
      ...data,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "mission.assignment.modifiee",
      cible: `mission:${params.id}`,
      detail: `MissionAssignment ${assignment.id} : ${Object.keys(data).join(", ")} modifié(s).`,
    });

    return NextResponse.json(assignment, { status: 200 });
  } catch (erreur) {
    if (erreur instanceof AssignmentIntrouvableError) {
      return NextResponse.json({ error: "MissionAssignment introuvable" }, { status: 404 });
    }
    if (erreur instanceof AssignmentNonActifError) {
      return NextResponse.json({ error: "Cette MissionAssignment n'est plus ACTIF." }, { status: 409 });
    }
    if (erreur instanceof AssignmentDejaTerminaleError) {
      return NextResponse.json({ error: "Cette MissionAssignment est déjà dans un état terminal (TERMINE/ANNULE)." }, { status: 409 });
    }
    if (erreur instanceof DateIncoherenteError) {
      return NextResponse.json({ error: "dateFin doit être postérieure ou égale à dateDebut." }, { status: 400 });
    }
    if (erreur instanceof AllocationInvalideError) {
      return NextResponse.json({ error: "allocationPct doit être un entier entre 0 et 100, ou null." }, { status: 400 });
    }
    if (erreur instanceof ResponsablePrincipalDejaPresentError) {
      return NextResponse.json({ error: "Cette Mission a déjà un responsable principal actif." }, { status: 409 });
    }
    throw erreur;
  }
}
