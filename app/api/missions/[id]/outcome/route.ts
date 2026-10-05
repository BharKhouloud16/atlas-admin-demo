import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  creerOutcomeAssessmentAvecRetry,
  lireOutcomeCourant,
  lireCriteresDisponibles,
  CritereInconnuError,
  MissionIntrouvableError,
} from "@/lib/outcome/service";
import type { OutcomeMethodeVerification, OutcomeStatut } from "@prisma/client";

// COMPANY ATLAS — A6.1 : Outcome Foundation (01/10/2026).
//
// Mission / Evaluation / Outcome restent strictement séparés (A6
// §A6.3/§A6.14) : cette route ne modifie JAMAIS Mission.statut ni le
// modèle Evaluation. "TERMINEE" reste une clôture administrative, jamais
// une preuve de résultat — c'est pourquoi POST exige explicitement
// mission.statut === "TERMINEE" (précondition, même logique que
// POST /api/evaluations), jamais une conséquence automatique de la
// transition.
//
// Gouvernance (A6 §A6.11) : seul un ADMIN peut créer/superséder une
// évaluation d'Outcome — jamais le Client (conflit de rôle : juge de son
// propre résultat), jamais l'Ingénieur (auto-validation), jamais un
// Agent (aucun appelant Agent n'existe dans ce lot — passerait par B22 si
// un jour introduit, jamais par cette route directement). Le Client peut
// en revanche LIRE l'Outcome de ses propres Mission (GET), au même titre
// qu'une Evaluation — jamais le créer ou le modifier.
const STATUTS_VALIDES: OutcomeStatut[] = ["OBTENU", "PARTIELLEMENT_OBTENU", "NON_OBTENU", "INDETERMINABLE"];
const METHODES_VALIDES: OutcomeMethodeVerification[] = ["VERIFIE_HUMAIN", "DECLARE_CLIENT", "MESURE_SYSTEME", "INFERE_IA"];

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "CLIENT")) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: params.id }, select: { id: true, clientId: true } });
  if (!mission) return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  if (session.role === "CLIENT" && mission.clientId !== session.clientId) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  const [outcome, contexte] = await Promise.all([lireOutcomeCourant(params.id), lireCriteresDisponibles(params.id)]);
  return NextResponse.json({ outcome, ...contexte });
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
      contexteRoute: "/api/missions/[id]/outcome",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Mission",
      ressourceId: params.id,
      detail: "Tentative de création/supersession d'un OutcomeAssessment par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: params.id }, select: { id: true, clientId: true, statut: true } });
  if (!mission) return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });

  // Précondition — jamais une conséquence de celle-ci (voir en-tête).
  if (mission.statut !== "TERMINEE") {
    return NextResponse.json(
      { error: "L'évaluation d'Outcome n'est possible que pour une mission TERMINEE (clôture administrative, jamais une preuve de résultat)." },
      { status: 409 }
    );
  }

  const body = await req.json().catch(() => null);
  const verdictsBruts = Array.isArray(body?.verdicts) ? body.verdicts : [];

  const verdicts = [];
  for (const v of verdictsBruts) {
    if (typeof v?.sourceFaitId !== "string" || !v.sourceFaitId) {
      return NextResponse.json({ error: "Chaque verdict doit référencer un sourceFaitId." }, { status: 400 });
    }
    if (typeof v.statutPropose !== "string" || !STATUTS_VALIDES.includes(v.statutPropose)) {
      return NextResponse.json({ error: "statutPropose invalide." }, { status: 400 });
    }
    const methodes = Array.isArray(v.methodes) ? v.methodes : [];
    if (methodes.some((m: unknown) => typeof m !== "string" || !METHODES_VALIDES.includes(m as OutcomeMethodeVerification))) {
      return NextResponse.json({ error: "methodes invalides." }, { status: 400 });
    }
    const evidencesBrutes = Array.isArray(v.evidences) ? v.evidences : [];
    const evidences = [];
    for (const e of evidencesBrutes) {
      if (typeof e?.source !== "string" || e.source.trim().length === 0) {
        return NextResponse.json({ error: "Chaque preuve doit avoir une source non vide." }, { status: 400 });
      }
      evidences.push({ source: e.source.trim().slice(0, 200), detail: typeof e.detail === "string" ? e.detail.trim().slice(0, 1000) : null });
    }
    verdicts.push({
      sourceFaitId: v.sourceFaitId,
      statutPropose: v.statutPropose as OutcomeStatut,
      methodes: methodes as OutcomeMethodeVerification[],
      evidences,
    });
  }

  try {
    const outcome = await creerOutcomeAssessmentAvecRetry({
      missionId: mission.id,
      clientId: mission.clientId,
      assessedByEmail: session.email,
      assessedByRole: session.role,
      verdicts,
    });

    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "objet.consultation",
      resultat: "SUCCES",
      severite: "INFO",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/outcome",
      acteurEmail: session.email,
      acteurRole: session.role,
      ressourceType: "Mission",
      ressourceId: mission.id,
      detail: `Création d'un OutcomeAssessment (overallStatus=${outcome.overallStatus}) pour la mission ${mission.id}.`,
    });

    return NextResponse.json({ outcome }, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof MissionIntrouvableError) {
      return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
    }
    if (erreur instanceof CritereInconnuError) {
      return NextResponse.json({ error: "Un verdict référence un critère qui n'appartient pas à la version du Need évaluée." }, { status: 400 });
    }
    throw erreur;
  }
}
