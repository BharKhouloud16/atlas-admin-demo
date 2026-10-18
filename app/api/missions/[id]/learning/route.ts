import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  creerLearningAvecRetry,
  listerLearningsMission,
  MissionIntrouvableError,
  ContenuManquantError,
  TypeInvalideError,
  ProvenanceInvalideError,
  ConfidenceInvalideError,
  ScopeInvalideError,
  ScopeNonAutoriseError,
  SourceIntrouvableError,
  SourceMultipleError,
  SupersedesIntrouvableError,
  DejaSupersedeError,
} from "@/lib/learning/learning";
import { estIngenieurAutoriseSurMission } from "@/lib/delivery-evidence/access";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A30 : Learning Foundation (05/10/2026).
//
// RBAC (Learning Contract §18, audité) : ADMIN — créer, lire, valider,
// superséder (toujours). INGENIEUR — créer et lire UNIQUEMENT sur une
// Mission où il est autorisé (lib/delivery-evidence/access.ts::
// estIngenieurAutoriseSurMission, même fonction partagée que A26/A27/A29),
// jamais valider/superséder (non explicitement accordé par le contrat,
// donc refusé par défaut — "il ne doit jamais pouvoir transformer seul
// une inférence en connaissance ATLAS globale"). CLIENT — le contrat
// (§18) autorise une lecture "lorsque le scope et les règles client le
// permettent", mais ne définit aucune règle concrète déterminant QUAND
// cela est permis ; en l'absence de cette règle, et par cohérence avec
// §13/§24 ("le Learning doit être plus petit que sa source", "aucune
// donnée client ne doit devenir automatiquement une connaissance ATLAS"),
// ce lot retient par défaut AUCUN accès Client (0 est un cas valide de
// "lorsque... permettent" tant qu'aucune règle ne permet jamais rien) —
// décision documentée explicitement dans le rapport final A30, à
// reconfirmer explicitement avant tout accès Client futur. Aucun rôle
// Agent (même limitation documentée que A26/A27/A29).
async function resoudreAccesLecture(missionId: string, role: string, profilId: string | null): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (role === "INGENIEUR") return estIngenieurAutoriseSurMission(missionId, profilId);
  return false;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR")) {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/learning",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Mission",
      ressourceId: params.id,
      detail: "Tentative de lecture de Learning par un rôle non autorisé.",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!mission) return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });

  if (!(await resoudreAccesLecture(params.id, session.role, session.profilId ?? null))) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  const learnings = await listerLearningsMission(params.id);
  return NextResponse.json({ missionId: params.id, learnings });
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
      contexteRoute: "/api/missions/[id]/learning",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Mission",
      ressourceId: params.id,
      detail: "Tentative de création d'un Learning par un rôle non autorisé.",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  if (session.role === "INGENIEUR" && !(await estIngenieurAutoriseSurMission(params.id, session.profilId ?? null))) {
    // Mission introuvable ET Mission d'un autre Ingénieur produisent la
    // même erreur — jamais une fuite d'existence IDOR.
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);

  try {
    const learning = await creerLearningAvecRetry({
      missionId: params.id,
      type: body?.type,
      title: body?.title,
      statement: body?.statement,
      provenance: body?.provenance,
      confidence: body?.confidence,
      scope: body?.scope,
      sourceWorkItemId: body?.sourceWorkItemId,
      sourceDeliverableId: body?.sourceDeliverableId,
      sourceDeliverableVersionId: body?.sourceDeliverableVersionId,
      sourceDeliveryEvidenceId: body?.sourceDeliveryEvidenceId,
      sourceDeliveryQualityGateId: body?.sourceDeliveryQualityGateId,
      sourceOutcomeAssessmentId: body?.sourceOutcomeAssessmentId,
      sourceFinancialResultId: body?.sourceFinancialResultId,
      supersedesId: typeof body?.supersedesId === "string" ? body.supersedesId : null,
      createdByEmail: session.email,
      createdByRole: session.role,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: session.role,
      action: learning.supersedesId ? "learning.superseded" : "learning.created",
      cible: `mission:${params.id}`,
      detail: `Learning ${learning.id} créé (type ${learning.type}, scope ${learning.scope}).${
        learning.supersedesId ? ` Supersède ${learning.supersedesId}.` : ""
      }`,
    });

    return NextResponse.json(learning, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof MissionIntrouvableError) {
      return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
    }
    if (erreur instanceof ContenuManquantError) {
      return NextResponse.json({ error: `${erreur.champ} requis (texte non vide).` }, { status: 400 });
    }
    if (erreur instanceof TypeInvalideError) {
      return NextResponse.json({ error: "type invalide." }, { status: 400 });
    }
    if (erreur instanceof ProvenanceInvalideError) {
      return NextResponse.json({ error: "provenance invalide." }, { status: 400 });
    }
    if (erreur instanceof ConfidenceInvalideError) {
      return NextResponse.json({ error: "confidence invalide." }, { status: 400 });
    }
    if (erreur instanceof ScopeInvalideError) {
      return NextResponse.json({ error: "scope invalide." }, { status: 400 });
    }
    if (erreur instanceof ScopeNonAutoriseError) {
      return NextResponse.json({ error: "Un Ingénieur ne peut déclarer qu'un Learning de portée MISSION." }, { status: 403 });
    }
    if (erreur instanceof SourceMultipleError) {
      return NextResponse.json({ error: "Une seule source précise est autorisée à la fois." }, { status: 400 });
    }
    if (erreur instanceof SourceIntrouvableError) {
      return NextResponse.json({ error: "Source précise introuvable pour cette Mission." }, { status: 404 });
    }
    if (erreur instanceof SupersedesIntrouvableError) {
      return NextResponse.json({ error: "Learning à superséder introuvable pour cette Mission." }, { status: 404 });
    }
    if (erreur instanceof DejaSupersedeError) {
      return NextResponse.json({ error: "Ce Learning est déjà supersédé." }, { status: 409 });
    }
    throw erreur;
  }
}
