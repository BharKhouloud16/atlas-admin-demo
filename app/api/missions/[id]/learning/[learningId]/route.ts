import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  lireLearning,
  validerLearning,
  marquerObsoleteLearning,
  LearningIntrouvableError,
  DejaValideError,
  DejaObsoleteError,
} from "@/lib/learning/learning";
import { estIngenieurAutoriseSurMission } from "@/lib/delivery-evidence/access";

// COMPANY ATLAS — A30 : Learning Foundation (05/10/2026).
//
// PATCH distingue deux actions, jamais confondues (même convention que
// .../quality/[qualityId]/route.ts A27 et .../financial-results/
// [resultId]/route.ts A29) : "valider" (PROPOSE -> VALIDE) et
// "marquer_obsolete" (ACTIVE -> OBSOLETE) — les deux réservées ADMIN
// (Learning Contract §18 : ni "valider" ni "superséder" ne sont
// explicitement accordés à l'Ingénieur, donc refusés par défaut). Aucune
// autre mutation de contenu n'existe : title/statement/type/provenance/
// confidence/scope/source sont immuables dès la création (contrat A30
// §13, "ne jamais réécrire l'apprentissage historique" — une correction
// de contenu crée une nouvelle ligne via POST .../learning avec
// `supersedesId`, jamais un PATCH ici).
export async function GET(_req: NextRequest, { params }: { params: { id: string; learningId: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR")) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  if (session.role === "INGENIEUR" && !(await estIngenieurAutoriseSurMission(params.id, session.profilId ?? null))) {
    return NextResponse.json({ error: "Learning introuvable" }, { status: 404 });
  }

  try {
    const learning = await lireLearning(params.id, params.learningId);
    return NextResponse.json(learning);
  } catch (erreur) {
    if (erreur instanceof LearningIntrouvableError) {
      return NextResponse.json({ error: "Learning introuvable" }, { status: 404 });
    }
    throw erreur;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; learningId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/learning/[learningId]",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Learning",
      ressourceId: params.learningId,
      detail: "Tentative de modification d'un Learning par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  if (body?.action === "valider") {
    try {
      const learning = await validerLearning(params.id, params.learningId, session.email);
      await journaliser({
        acteurEmail: session.email,
        acteurRole: session.role,
        action: "learning.validated",
        cible: `mission:${params.id}`,
        detail: `Learning ${learning.id} validé.`,
      });
      return NextResponse.json(learning);
    } catch (erreur) {
      if (erreur instanceof LearningIntrouvableError) {
        return NextResponse.json({ error: "Learning introuvable" }, { status: 404 });
      }
      if (erreur instanceof DejaValideError) {
        return NextResponse.json({ error: "Ce Learning est déjà validé." }, { status: 409 });
      }
      throw erreur;
    }
  }

  if (body?.action === "marquer_obsolete") {
    try {
      const learning = await marquerObsoleteLearning(params.id, params.learningId, session.email);
      // "learning.updated" n'est volontairement jamais émis (contrat A30
      // §22, "uniquement lorsqu'ils correspondent réellement aux
      // actions") : aucune route de ce lot ne permet d'édition générique
      // de contenu, seulement les transitions nommées ci-dessus.
      await journaliser({
        acteurEmail: session.email,
        acteurRole: session.role,
        action: "learning.marked_obsolete",
        cible: `mission:${params.id}`,
        detail: `Learning ${learning.id} marqué obsolète.`,
      });
      return NextResponse.json(learning);
    } catch (erreur) {
      if (erreur instanceof LearningIntrouvableError) {
        return NextResponse.json({ error: "Learning introuvable" }, { status: 404 });
      }
      if (erreur instanceof DejaObsoleteError) {
        return NextResponse.json({ error: "Ce Learning est déjà obsolète." }, { status: 409 });
      }
      throw erreur;
    }
  }

  return NextResponse.json({ error: "action invalide (seules 'valider' et 'marquer_obsolete' sont supportées)." }, { status: 400 });
}
