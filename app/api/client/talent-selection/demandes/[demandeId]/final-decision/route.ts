import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { candidateFinalDecisionSchema, premierMessageZod } from "@/lib/validation";
import {
  CandidateSelectionReferenceIntrouvableError,
  CommuniqueHorsSystemeRequisError,
  DecisionActiveExistanteError,
  DejaSupersedeError,
  DemandeTalentIntrouvableError,
  EntreesInvalidesError,
  JustificationRequiseError,
  SupersedesIntrouvableError,
  creerCandidateFinalDecisionAvecRetry,
  lireCandidateFinalDecisionActive,
  listerCandidateFinalDecisionsDemandeTalent,
} from "@/lib/candidate-decision/final-decision";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §1.5, §7, §15, CTO Validation §13 (verrouillée). Cette route Client ne
// peut JAMAIS produire `communiqueParClientHorsSysteme: true` — seule la
// route Admin (POST .../final-decision, §15 Admin-facing) peut le faire,
// et uniquement avec `canalHorsSysteme` renseigné. `decideParRole` est ici
// TOUJOURS "CLIENT", jamais lu depuis le body.
export async function GET(_req: NextRequest, { params }: { params: { demandeId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findFirst({ where: { id: params.demandeId, clientId: session.clientId }, select: { id: true } });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  }

  const [active, historique] = await Promise.all([
    lireCandidateFinalDecisionActive(params.demandeId),
    listerCandidateFinalDecisionsDemandeTalent(params.demandeId),
  ]);

  return NextResponse.json({ demandeId: params.demandeId, active, historique });
}

export async function POST(req: NextRequest, { params }: { params: { demandeId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findFirst({ where: { id: params.demandeId, clientId: session.clientId }, select: { id: true } });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  }

  const corps = await req.json().catch(() => null);
  const analyse = candidateFinalDecisionSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  const actuelle = await lireCandidateFinalDecisionActive(params.demandeId);

  try {
    const decision = await creerCandidateFinalDecisionAvecRetry({
      demandeTalentId: params.demandeId,
      decideParEmail: session.email,
      decideParRole: "CLIENT",
      entrees: analyse.data.entrees,
      supersedesId: actuelle?.id ?? null,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "CLIENT",
      action: "candidate.final_decision.recorded",
      cible: `demande:${params.demandeId} decision:${decision.id}`,
    });

    return NextResponse.json(decision, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof DemandeTalentIntrouvableError) {
      return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
    }
    if (erreur instanceof CommuniqueHorsSystemeRequisError) {
      return NextResponse.json({ error: "Décision invalide." }, { status: 400 });
    }
    if (erreur instanceof EntreesInvalidesError || erreur instanceof JustificationRequiseError) {
      return NextResponse.json({ error: "Les entrées de décision sont invalides (justification requise pour NON_RETENU)." }, { status: 400 });
    }
    if (erreur instanceof CandidateSelectionReferenceIntrouvableError) {
      return NextResponse.json({ error: "Une ou plusieurs sélections référencées sont introuvables." }, { status: 404 });
    }
    if (erreur instanceof DecisionActiveExistanteError || erreur instanceof SupersedesIntrouvableError) {
      return NextResponse.json({ error: "Une décision active existe déjà — réessayez (conflit de concurrence)." }, { status: 409 });
    }
    if (erreur instanceof DejaSupersedeError) {
      return NextResponse.json({ error: "Cette décision a déjà été remplacée." }, { status: 409 });
    }
    throw erreur;
  }
}
