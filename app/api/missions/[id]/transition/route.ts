import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { executerTransitionMission, type ActionLifecycle } from "@/lib/mission/lifecycle";

// ATLAS — MISSION LIFECYCLE ENGINE (A22, 05/10/2026 — étend Phase 2B-0/
// LOT 16.2, même endpoint, jamais une seconde route créée).
//
// Transition de statut contrôlée pour Mission — même convention que
// app/api/factures/[id]/transition/route.ts : une whitelist stricte
// d'actions, jamais une écriture arbitraire de `statut` depuis le body.
// Toute la logique métier (matrice de transitions, préconditions
// Assignment/raison, concurrence, journalisation) est centralisée dans
// lib/mission/lifecycle.ts — cette route reste fine : RBAC, parsing du
// body, traduction code métier -> HTTP, rien d'autre.
//
// Réservé Admin, jamais l'Ingénieur (même sur sa propre mission) ni le
// Client — inchangé depuis Phase 2B-0.
//
// RÈGLE ABSOLUE (Phase 2B-0 §13, réaffirmée A22 §8) : une Mission
// TERMINEE n'est PAS une preuve de résultat. Cette route ne touche jamais
// SkillEvidence/ProfilCompetence/OutcomeAssessment/MissionAssignment.statut/
// MissionCapabilityLink.statut — EN_COURS -> TERMINEE reste autorisée sans
// aucune précondition WorkItem/Deliverable/Evidence/Quality/Outcome.
const ACTIONS_VALIDES: ActionLifecycle[] = ["rendre_prete", "demarrer", "bloquer", "debloquer", "terminer", "annuler"];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  if (typeof action !== "string" || !ACTIONS_VALIDES.includes(action as ActionLifecycle)) {
    return NextResponse.json(
      { error: "Action invalide (rendre_prete, demarrer, bloquer, debloquer, terminer ou annuler attendu)." },
      { status: 400 }
    );
  }

  const resultat = await executerTransitionMission({
    missionId: params.id,
    action: action as ActionLifecycle,
    raison: typeof body?.raison === "string" ? body.raison : undefined,
    raisonResolution: typeof body?.raisonResolution === "string" ? body.raisonResolution : undefined,
    motif: typeof body?.motif === "string" ? body.motif : undefined,
    acteurEmail: session.email,
    acteurRole: "ADMIN",
  });

  if (!resultat.ok) {
    switch (resultat.code) {
      case "MISSION_INTROUVABLE":
        return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });
      case "TRANSITION_INVALIDE":
        return NextResponse.json(
          { error: `Transition impossible depuis le statut actuel (${resultat.depuis} -> ${resultat.vers}).` },
          { status: 409 }
        );
      case "ASSIGNMENT_ACTIF_MANQUANT":
        return NextResponse.json({ error: "Aucun MissionAssignment ACTIF — la Mission ne peut pas être marquée PRETE." }, { status: 409 });
      case "RESPONSABLE_PRINCIPAL_MANQUANT":
        return NextResponse.json({ error: "Aucun MissionAssignment ACTIF avec estResponsablePrincipal=true — la Mission ne peut pas démarrer." }, { status: 409 });
      case "RAISON_BLOCAGE_MANQUANTE":
        return NextResponse.json({ error: "raison requise pour bloquer une Mission." }, { status: 400 });
      case "RAISON_BLOCAGE_INVALIDE":
        return NextResponse.json({ error: "raison invalide (CLIENT_DEPENDENCY, TALENT_DEPENDENCY, TECHNICAL, ACCESS, EXTERNAL ou UNKNOWN attendu)." }, { status: 400 });
      case "RAISON_RESOLUTION_MANQUANTE":
        return NextResponse.json({ error: "raisonResolution requise pour débloquer une Mission." }, { status: 400 });
      case "MOTIF_MANQUANT":
        return NextResponse.json({ error: "motif requis pour cette transition." }, { status: 400 });
      default:
        return NextResponse.json({ error: "Transition refusée." }, { status: 409 });
    }
  }

  return NextResponse.json(resultat.mission);
}
