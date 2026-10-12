import { prisma } from "@/lib/prisma";
import { journaliser } from "@/lib/audit";
import { resoudreAiProvider } from "@/lib/ai/provider";
import type { PointeurFait, SuggestionLearning } from "@/lib/ai/provider";
import { creerLearningAvecRetry } from "@/lib/learning/learning";
import { construireDossierFaits, MissionIntrouvableLearningLoopError, MissionNonTermineeError, type DossierFaits } from "./facts";
import { compterMissionsComparables } from "./recurrence";
import { determinerConfidence, determinerProvenance, determinerScope, determinerType, deriverSignalResultat, contientAffirmationCausaleNonJustifiee, compterFaitsVerifies } from "./classification";
import { estDoublon } from "./duplicates";
import { detecterContradictions } from "./contradictions";

// COMPANY ATLAS — A34 : Learning Loop Runtime (06/10/2026).
//
// Orchestrateur des deux Steps du Learning Loop (contrat A34 §21) — appelé
// EXCLUSIVEMENT par le Tool lib/agentic/tools.ts (jamais directement par
// une route). Reste DANS la state machine A32 (lib/agentic/runtime.ts,
// non modifié) : ce module ne crée jamais de nouvel état AgenticRun, il
// se limite à faire transiter le Run existant vers un état déjà prévu par
// A32 (SUCCEEDED) via le même patron d'écriture conditionnelle
// (WHERE id + statut attendu) que celui déjà utilisé par runtime.ts —
// `transition()` y est une fonction privée, non exportée ; le patron est
// reproduit ici à l'identique plutôt que dupliqué différemment (voir
// rapport final A34, §6 Architecture, pour la justification complète de
// ce choix et son alternative écartée).

export type ToolResultatSimple = { ok: boolean; detail: string; data?: Record<string, unknown> };

// ---------------------------------------------------------------------------
// STEP 1 — OBSERVE_ONLY : collecte, normalisation, fact dossier, pointeurs,
// incertitudes, contradictions FACTUELLES (contrat A34 §21). Zéro écriture
// métier — seul le dossier est renvoyé dans ActionExecution.resultat (le
// Runtime A32, non modifié, s'en charge).
// ---------------------------------------------------------------------------
export async function executerObservation(missionId: string): Promise<ToolResultatSimple> {
  let dossier: DossierFaits;
  try {
    dossier = await construireDossierFaits(missionId);
  } catch (erreur) {
    if (erreur instanceof MissionIntrouvableLearningLoopError || erreur instanceof MissionNonTermineeError) {
      // Ne devrait jamais arriver ici : déjà vérifié à la création du Run
      // (app/api/agentic-runs/route.ts) — défensif uniquement.
      return { ok: false, detail: `Mission invalide pour l'observation (${erreur.message}).` };
    }
    throw erreur;
  }

  const incertitudes: string[] = [];
  if (dossier.pointeurs.length === 0) incertitudes.push("Aucun fait exploitable trouvé pour cette Mission.");
  if (!dossier.outcomeStatut && !dossier.financialResultGlobal) {
    incertitudes.push("Aucun Outcome ni FinancialResult — signal de résultat non déterminable.");
  }

  return {
    ok: true,
    detail: `Dossier factuel construit : ${dossier.pointeurs.length} pointeur(s).`,
    data: { dossier: dossier as unknown as Record<string, unknown>, incertitudes },
  };
}

// ---------------------------------------------------------------------------
// STEP 2 — PROPOSE_AND_ACT : classification, duplicate check, contradiction
// check, construction candidat, création Learning PROPOSE (contrat A34
// §21) — puis complète le Run (SUCCEEDED, GOAL_REACHED ou NOT_DETERMINABLE,
// contrat A34 §23). Relit le dossier de la Step 1 depuis
// ActionExecution.resultat (jamais recalculé en divergence — contrat A34
// §26, chaîne reconstructible).
// ---------------------------------------------------------------------------
export async function executerPropositionEtAction(params: {
  runId: string;
  stepId: string;
  missionId: string;
  correlationId: string;
  createdByEmail: string;
  createdByRole: string;
}): Promise<ToolResultatSimple> {
  const stepObservation = await prisma.agenticStep.findFirst({
    where: { runId: params.runId, stepIndex: 1 },
    include: { actionExecution: true },
  });
  const dossierBrut = stepObservation?.actionExecution?.resultat as { dossier?: DossierFaits } | null | undefined;
  const dossier = dossierBrut?.dossier ?? (await construireDossierFaits(params.missionId));

  // A35.3-FIX (contrat A35 F4) : le signal recherché (signal de la Mission
  // COURANTE) doit être connu avant de compter les Missions comparables,
  // pour pouvoir distinguer récidive positive de récidive contradictoire
  // (voir recurrence.ts) — ordre inversé par rapport à l'ancienne version,
  // comportement de deriverSignalResultat lui-même inchangé.
  const signal = deriverSignalResultat(dossier);
  const { count: missionsComparablesCount } = await compterMissionsComparables(params.missionId, signal);

  const provider = resoudreAiProvider();
  const suggestion = await provider.proposerApprentissage({
    missionId: params.missionId,
    faits: dossier.pointeurs,
    missionsComparablesCount,
  });

  // Le provider reste PUREMENT consultatif (contrat A34 §18) : chaque
  // candidat est revalidé/reclassifié intégralement ci-dessous. Un champ
  // non conforme (type/scope/confidence hors vocabulaire fermé, pointeur
  // vers un fait absent du dossier) est IGNORÉ, jamais toléré partiellement
  // (contrat A34 §20, "si le provider retourne des champs non conformes ->
  // ils sont ignorés").
  const candidatsExploitables = suggestion.candidats.filter((c) => estCandidatExploitable(c, dossier.pointeurs));

  for (const candidat of candidatsExploitables) {
    const pointeur = dossier.pointeurs.find((p) => p.sourceType === candidat.pointeurFaitPrincipal?.sourceType && p.id === candidat.pointeurFaitPrincipal?.id);
    if (!pointeur) continue;

    const type = determinerType(missionsComparablesCount, signal, candidat.type);
    const provenance = determinerProvenance(pointeur);
    const confidence = determinerConfidence(missionsComparablesCount, pointeur.palier, compterFaitsVerifies(dossier.pointeurs));
    const scope = determinerScope();
    const titre = candidat.titre.trim().slice(0, 200);
    let statement = candidat.statement.trim();

    // Garde-fou causalité (contrat A34 §11) — reformule en association
    // prudente plutôt que de rejeter silencieusement le candidat (une
    // information réelle ne doit jamais disparaître à cause d'une
    // formulation maladroite, seule la formulation est corrigée).
    if (contientAffirmationCausaleNonJustifiee(statement, pointeur.palier)) {
      statement = `Association observée (non causale) : ${statement}`;
    }

    if (await estDoublon(params.missionId, type, titre, pointeur.sourceType, pointeur.id)) {
      continue; // contrat A34 §13 : jamais de doublon exact, candidat suivant.
    }

    const contradictions = await detecterContradictions(params.missionId, dossier.clientId, type, titre);
    const justificationAvecContradictions =
      contradictions.length > 0
        ? `${candidat.justification}\n\nContradiction(s) détectée(s) avec Learning(s) existant(s), conservées sans arbitrage automatique : ${contradictions.map((c) => `${c.learningId} (${c.type})`).join(", ")}.`
        : candidat.justification;

    const sourceChampParType: Record<string, string> = {
      WORK_ITEM: "sourceWorkItemId",
      DELIVERABLE: "sourceDeliverableId",
      DELIVERABLE_VERSION: "sourceDeliverableVersionId",
      DELIVERY_EVIDENCE: "sourceDeliveryEvidenceId",
      QUALITY_GATE: "sourceDeliveryQualityGateId",
      OUTCOME_ASSESSMENT: "sourceOutcomeAssessmentId",
      FINANCIAL_RESULT: "sourceFinancialResultId",
    };
    const champSource = sourceChampParType[pointeur.sourceType];

    const learning = await creerLearningAvecRetry({
      missionId: params.missionId,
      type,
      title: titre,
      statement: `${statement}\n\n${justificationAvecContradictions}`.trim().slice(0, 4000),
      provenance,
      confidence,
      scope,
      ...(champSource ? { [champSource]: pointeur.id } : {}),
      createdByEmail: params.createdByEmail,
      createdByRole: params.createdByRole,
    });

    // correlationId copié EXACTEMENT depuis l'AgenticRun (contrat A33 §10,
    // décision CTO D1) — jamais généré localement, jamais via
    // creerLearningAvecRetry (hors périmètre A30, non modifié).
    await prisma.learning.update({ where: { id: learning.id }, data: { correlationId: params.correlationId } });

    await journaliser({
      acteurEmail: params.createdByEmail,
      acteurRole: params.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
      action: "agentic.learning_loop.learning_proposed",
      cible: `learning:${learning.id}`,
      detail: `AgenticRun ${params.runId} : Learning ${learning.id} créé (statut PROPOSE, type ${type}, confidence ${confidence}, provenance ${provenance}) depuis ${pointeur.sourceType}:${pointeur.id}.`,
      correlationId: params.correlationId,
    });

    await completerRun(params.runId, "GOAL_REACHED", `Learning ${learning.id} proposé (PROPOSE).`, params);
    return { ok: true, detail: `Learning ${learning.id} créé (PROPOSE).`, data: { learningId: learning.id, type, confidence, provenance } };
  }

  // Aucun candidat exploitable/non-dupliqué : conclusion NOT_DETERMINABLE
  // (contrat A34 §23) — un SUCCEEDED, jamais un FAILED (l'analyse a
  // correctement conclu qu'aucun Learning fiable ne pouvait être proposé).
  await completerRun(params.runId, "NOT_DETERMINABLE", "Aucun Learning fiable n'a pu être proposé (faits insuffisants, doublons, ou aucun candidat exploitable).", params);
  return { ok: true, detail: "Aucun Learning créé — NOT_DETERMINABLE.", data: { learningId: null } };
}

function estCandidatExploitable(candidat: SuggestionLearning, pointeurs: PointeurFait[]): boolean {
  if (!candidat.titre?.trim() || !candidat.statement?.trim()) return false;
  if (!candidat.pointeurFaitPrincipal) return false;
  return pointeurs.some((p) => p.sourceType === candidat.pointeurFaitPrincipal!.sourceType && p.id === candidat.pointeurFaitPrincipal!.id);
}

// Complète le Run DANS la state machine A32 (RUNNING -> SUCCEEDED
// uniquement, un état déjà défini par A32 — jamais un nouvel état).
// Écriture conditionnelle (WHERE id + statut=RUNNING), même patron que
// lib/agentic/runtime.ts::transition() (privée, non exportée — reproduite
// ici à l'identique, voir rapport final A34 §6).
async function completerRun(
  runId: string,
  stopReason: "GOAL_REACHED" | "NOT_DETERMINABLE",
  resultSummary: string,
  params: { createdByEmail: string; createdByRole: string; correlationId: string }
) {
  const ecriture = await prisma.agenticRun.updateMany({
    where: { id: runId, statut: "RUNNING" },
    data: { statut: "SUCCEEDED", stopReason, resultSummary: resultSummary.slice(0, 2000), completedAt: new Date() },
  });
  if (ecriture.count === 0) return; // concurrence : un autre appel a déjà conclu, jamais une double écriture.

  await journaliser({
    acteurEmail: params.createdByEmail,
    acteurRole: params.createdByRole as "ADMIN" | "INGENIEUR" | "CLIENT",
    action: "agentic.run.succeeded",
    cible: `agentic-run:${runId}`,
    detail: `AgenticRun ${runId} terminé (Learning Loop) : stopReason=${stopReason}.`,
    correlationId: params.correlationId,
  });
}
