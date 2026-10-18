import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  lireQualityGate,
  mettreAJourQualityGate,
  finaliserQualityGate,
  QualityGateIntrouvableError,
  QualityGateFinaliseeError,
  CriteresInvalidesError,
  ResultatInvalideError,
  TransitionInvalideError,
} from "@/lib/delivery-quality/quality";
import { estIngenieurAutoriseSurMission, estClientAutoriseSurMission } from "@/lib/delivery-evidence/access";

// COMPANY ATLAS — A27 : Quality Gate Foundation (05/10/2026).
//
// PATCH distingue deux usages, jamais confondus (contrat A27 §17/§18) :
// (1) édition de contenu (criteresEvalues/resultat) — uniquement tant
// que DRAFT, ADMIN ou l'Ingénieur PRÉPARATEUR (créateur) de cette ligne
// précise, jamais un autre Ingénieur ; (2) `action: "finaliser"` — ADMIN
// UNIQUEMENT, jamais l'Ingénieur même sur sa propre ligne (contrat
// A27 §17-21 : "l'Ingénieur ne peut jamais auto-finaliser sa propre
// évaluation", même doctrine que OutcomeAssessment, A6.1 §A6.11). Le
// Client n'a jamais accès en écriture (contrat A27 §21).
async function resoudreAccesLecture(missionId: string, role: string, profilId: string | null, clientId: string | null): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (role === "INGENIEUR") return estIngenieurAutoriseSurMission(missionId, profilId);
  if (role === "CLIENT") return estClientAutoriseSurMission(missionId, clientId);
  return false;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string; qualityId: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR" && session.role !== "CLIENT")) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  if (!(await resoudreAccesLecture(params.id, session.role, session.profilId ?? null, session.clientId ?? null))) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  try {
    const qualityGate = await lireQualityGate(params.id, params.qualityId);
    return NextResponse.json(qualityGate);
  } catch (erreur) {
    if (erreur instanceof QualityGateIntrouvableError) {
      return NextResponse.json({ error: "DeliveryQualityGate introuvable" }, { status: 404 });
    }
    throw erreur;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; qualityId: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR")) {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/quality/[qualityId]",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "DeliveryQualityGate",
      ressourceId: params.qualityId,
      detail: "Tentative de modification d'une DeliveryQualityGate par un rôle non autorisé (Client ou non authentifié).",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  if (session.role === "INGENIEUR" && !(await estIngenieurAutoriseSurMission(params.id, session.profilId ?? null))) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  let gateActuelle;
  try {
    gateActuelle = await lireQualityGate(params.id, params.qualityId);
  } catch (erreur) {
    if (erreur instanceof QualityGateIntrouvableError) {
      return NextResponse.json({ error: "DeliveryQualityGate introuvable" }, { status: 404 });
    }
    throw erreur;
  }

  const body = await req.json().catch(() => ({}));

  // Branche (2) : finalisation — ADMIN uniquement, jamais l'Ingénieur,
  // même sur sa propre ligne (contrat A27 §17-21).
  if (typeof body?.action === "string") {
    if (body.action !== "finaliser") {
      return NextResponse.json({ error: "action invalide (seule 'finaliser' est supportée)." }, { status: 400 });
    }
    if (session.role !== "ADMIN") {
      await enregistrerEvenementSecurite({
        correlationId: nouveauCorrelationId(),
        action: "rbac.acces_refuse",
        resultat: "REFUSE",
        severite: "ALERTE",
        contexteIp: adresseIp(req),
        contexteRoute: "/api/missions/[id]/quality/[qualityId]",
        acteurEmail: session.email,
        acteurRole: session.role,
        ressourceType: "DeliveryQualityGate",
        ressourceId: params.qualityId,
        detail: "Tentative de finalisation d'une DeliveryQualityGate par un Ingénieur (réservé Admin, aucune auto-finalisation).",
      });
      return NextResponse.json({ error: "Seul l'administrateur peut finaliser une évaluation de qualité." }, { status: 403 });
    }

    try {
      const qualityGate = await finaliserQualityGate(params.id, params.qualityId);
      await journaliser({
        acteurEmail: session.email,
        acteurRole: session.role,
        action: "quality.finalized",
        cible: `mission:${params.id}`,
        detail: `DeliveryQualityGate ${qualityGate.id} finalisée (résultat ${qualityGate.resultat}).`,
      });
      return NextResponse.json(qualityGate);
    } catch (erreur) {
      if (erreur instanceof QualityGateIntrouvableError) {
        return NextResponse.json({ error: "DeliveryQualityGate introuvable" }, { status: 404 });
      }
      if (erreur instanceof TransitionInvalideError) {
        return NextResponse.json({ error: "Cette évaluation est déjà finalisée." }, { status: 409 });
      }
      throw erreur;
    }
  }

  // Branche (1) : édition de contenu — uniquement DRAFT, ADMIN ou le
  // créateur Ingénieur de cette ligne précise (jamais un autre
  // Ingénieur, même autorisé sur la Mission).
  if (session.role === "INGENIEUR" && gateActuelle.createdByEmail !== session.email) {
    return NextResponse.json({ error: "DeliveryQualityGate introuvable" }, { status: 404 });
  }

  try {
    const qualityGate = await mettreAJourQualityGate({
      missionId: params.id,
      qualityGateId: params.qualityId,
      criteresEvalues: body?.criteresEvalues,
      resultat: body?.resultat,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: session.role,
      action: "quality.updated",
      cible: `mission:${params.id}`,
      detail: `DeliveryQualityGate ${qualityGate.id} mise à jour (résultat ${qualityGate.resultat}).`,
    });

    return NextResponse.json(qualityGate);
  } catch (erreur) {
    if (erreur instanceof QualityGateIntrouvableError) {
      return NextResponse.json({ error: "DeliveryQualityGate introuvable" }, { status: 404 });
    }
    if (erreur instanceof QualityGateFinaliseeError) {
      return NextResponse.json({ error: "Cette évaluation est déjà finalisée, son contenu est immuable." }, { status: 409 });
    }
    if (erreur instanceof CriteresInvalidesError) {
      return NextResponse.json({ error: "criteresEvalues requis (non vide)." }, { status: 400 });
    }
    if (erreur instanceof ResultatInvalideError) {
      return NextResponse.json({ error: "resultat invalide (PASS, FAIL ou NOT_DETERMINABLE attendu)." }, { status: 400 });
    }
    throw erreur;
  }
}
