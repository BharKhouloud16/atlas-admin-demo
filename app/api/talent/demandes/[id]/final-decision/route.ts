import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { candidateFinalDecisionSchema, premierMessageZod } from "@/lib/validation";
import { z } from "zod";
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
// §1.5, §7, §15 Admin-facing, CTO Validation §13 (verrouillée). Admin
// enregistrant une décision communiquée par le Client HORS SYSTÈME —
// `communiqueParClientHorsSysteme: true` et `canalHorsSysteme` renseigné
// sont OBLIGATOIRES ici (jamais une décision Admin autonome). Jamais une
// décision pour compte du Client sans ces deux champs — le service
// lib/candidate-decision/final-decision.ts revérifie cette règle
// indépendamment de ce qui est validé ici.
const corpsAdminSchema = candidateFinalDecisionSchema.merge(
  z.object({
    communiqueParClientHorsSysteme: z.literal(true, {
      errorMap: () => ({ message: "communiqueParClientHorsSysteme doit être true pour un enregistrement Admin." }),
    }),
    canalHorsSysteme: z.string().trim().min(1, "canalHorsSysteme requis.").max(200),
  })
);

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  }

  const [active, historique] = await Promise.all([
    lireCandidateFinalDecisionActive(params.id),
    listerCandidateFinalDecisionsDemandeTalent(params.id),
  ]);

  return NextResponse.json({ demandeId: params.id, active, historique });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  }

  const corps = await req.json().catch(() => null);
  const analyse = corpsAdminSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  const actuelle = await lireCandidateFinalDecisionActive(params.id);

  try {
    const decision = await creerCandidateFinalDecisionAvecRetry({
      demandeTalentId: params.id,
      decideParEmail: session.email,
      decideParRole: "ADMIN",
      communiqueParClientHorsSysteme: analyse.data.communiqueParClientHorsSysteme,
      canalHorsSysteme: analyse.data.canalHorsSysteme,
      entrees: analyse.data.entrees,
      supersedesId: actuelle?.id ?? null,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "candidate.final_decision.recorded",
      cible: `demande:${params.id} decision:${decision.id}`,
      detail: `Communiqué hors système (${analyse.data.canalHorsSysteme})`,
    });

    return NextResponse.json(decision, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof DemandeTalentIntrouvableError) {
      return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
    }
    if (erreur instanceof CommuniqueHorsSystemeRequisError) {
      return NextResponse.json({ error: "communiqueParClientHorsSysteme et canalHorsSysteme sont requis pour un enregistrement Admin." }, { status: 400 });
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
