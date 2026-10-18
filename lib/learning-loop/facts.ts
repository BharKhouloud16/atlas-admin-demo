import { prisma } from "@/lib/prisma";
import type { PalierPreuve, PointeurFait } from "@/lib/ai/provider";

// COMPANY ATLAS — A34 : Learning Loop Runtime (06/10/2026).
//
// Construit le DOSSIER FACTUEL borné pour une Mission (contrat A34 §6) —
// une structure de pointeurs vers les 11 types de source réels (contrat
// A34 §4/§6), JAMAIS un texte narratif. Hiérarchie des sources respectée
// strictement (contrat A34 §7) : Mission=contexte, Need/Facts=contexte,
// WorkItem=signal faible, Deliverable/Version=signal de contenu,
// Evidence=couche factuelle, Quality=jugement fort, Outcome=jugement
// autoritatif, FinancialResult=résultat économique — jamais de causalité
// inventée entre ces couches (contrat A34 §11, voir classification.ts).
//
// Lecture PURE : ce module ne modifie JAMAIS Mission/WorkItem/Deliverable/
// DeliverableVersion/DeliveryEvidence/DeliveryQualityGate/
// OutcomeAssessment/FinancialResult/ClientNeed/ClientNeedFait/
// SolutionOption (même doctrine que lib/learning/learning.ts, A30).

export class MissionIntrouvableLearningLoopError extends Error {
  constructor() {
    super("MISSION_INTROUVABLE");
  }
}

export class MissionNonTermineeError extends Error {
  constructor(public readonly statutActuel: string) {
    super("MISSION_NON_TERMINEE");
  }
}

export type DossierFaits = {
  missionId: string;
  clientId: string;
  profilId: string;
  pointeurs: PointeurFait[];
  // Signaux agrégés nécessaires à la classification déterministe
  // (classification.ts) — jamais une interprétation, uniquement les
  // valeurs brutes des sources les plus fortes disponibles (contrat A34
  // §7/§9).
  outcomeStatut: "OBTENU" | "PARTIELLEMENT_OBTENU" | "NON_OBTENU" | "INDETERMINABLE" | null;
  financialResultGlobal: "PROFIT" | "BREAK_EVEN" | "LOSS" | "NOT_DETERMINABLE" | null;
  qualityResultats: ("PASS" | "FAIL" | "NOT_DETERMINABLE")[];
};

// Résumé court, factuel, jamais une reformulation/interprétation (contrat
// A34 §6, "ne transforme pas les données métier en grand texte
// narratif") — simple concaténation de champs déjà structurés.
function resumer(texte: string, max = 160): string {
  const t = texte.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export async function construireDossierFaits(missionId: string): Promise<DossierFaits> {
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    select: { id: true, clientId: true, profilId: true, statut: true, needVersionId: true, solutionDecisionId: true, repere: true },
  });
  if (!mission) throw new MissionIntrouvableLearningLoopError();
  // Contrat A34 §4 : Mission TERMINEE obligatoire, sinon 400 (gérée par
  // l'appelant — voir app/api/agentic-runs/route.ts) ; non-existante -> 404
  // (voir MissionIntrouvableLearningLoopError ci-dessus).
  if (mission.statut !== "TERMINEE") throw new MissionNonTermineeError(mission.statut);

  const pointeurs: PointeurFait[] = [];
  const ajouter = (sourceType: PointeurFait["sourceType"], id: string, palier: PalierPreuve, resume: string) =>
    pointeurs.push({ sourceType, id, palier, resume });

  // --- Need / Need facts (contexte / déclarations) ---------------------
  if (mission.needVersionId) {
    const need = await prisma.clientNeed.findUnique({
      where: { id: mission.needVersionId },
      select: { id: true, titre: true, faits: { where: { statutActivite: "ACTIVE" }, select: { id: true, cle: true, valeur: true, statut: true } } },
    });
    if (need) {
      ajouter("NEED", need.id, "BUSINESS_FACT", resumer(need.titre ?? "Need sans titre"));
      for (const fait of need.faits) {
        const palier: PalierPreuve = fait.statut === "VERIFIE" ? "VERIFIED_RESULT" : fait.statut === "INFERE" ? "INFERENCE" : "DECLARATION";
        ajouter("NEED_FACT", fait.id, palier, resumer(`${fait.cle}: ${fait.valeur}`));
      }
    }
  }

  // --- SolutionDecision (contexte / déclaration de décision) ------------
  if (mission.solutionDecisionId) {
    const decision = await prisma.solutionOption.findUnique({
      where: { id: mission.solutionDecisionId },
      select: { id: true, titre: true, niveau: true },
    });
    if (decision && decision.niveau === "DECISION") {
      ajouter("SOLUTION_DECISION", decision.id, "DECLARATION", resumer(decision.titre));
    }
  }

  // --- WorkItems (signal opérationnel faible) ---------------------------
  const workItems = await prisma.workItem.findMany({
    where: { missionId },
    select: { id: true, titre: true, statut: true },
  });
  for (const wi of workItems) {
    ajouter("WORK_ITEM", wi.id, "RAW_DATA", resumer(`${wi.titre} — ${wi.statut}`));
  }
  const workItemIds = workItems.map((w) => w.id);

  // --- Deliverables / DeliverableVersions (signal de contenu/version) ---
  const deliverables = await prisma.deliverable.findMany({
    where: { missionId },
    select: {
      id: true,
      versions: { where: { supersededBy: null }, select: { id: true, titre: true, statut: true, version: true } },
    },
  });
  const deliverableVersionIds: string[] = [];
  for (const d of deliverables) {
    ajouter("DELIVERABLE", d.id, "RAW_DATA", resumer(`Deliverable ${d.id}`));
    for (const v of d.versions) {
      deliverableVersionIds.push(v.id);
      ajouter("DELIVERABLE_VERSION", v.id, "BUSINESS_FACT", resumer(`${v.titre} — v${v.version} — ${v.statut}`));
    }
  }

  // --- DeliveryEvidence (couche factuelle) — cible XOR WorkItem/Version,
  // uniquement les lignes courantes (jamais supersédées) -----------------
  const evidences = workItemIds.length > 0 || deliverableVersionIds.length > 0
    ? await prisma.deliveryEvidence.findMany({
        where: {
          supersededBy: null,
          OR: [
            ...(workItemIds.length > 0 ? [{ workItemId: { in: workItemIds } }] : []),
            ...(deliverableVersionIds.length > 0 ? [{ deliverableVersionId: { in: deliverableVersionIds } }] : []),
          ],
        },
        select: { id: true, methode: true, confiance: true, contenu: true },
      })
    : [];
  for (const ev of evidences) {
    // Mapping palier EXACT depuis la confiance déjà portée par la source
    // elle-même (contrat A34 §8) — jamais une promotion/dégradation.
    const palier: PalierPreuve =
      ev.confiance === "VERIFIE" ? "VERIFIED_RESULT" : ev.confiance === "DECLARE" ? "DECLARATION" : ev.confiance === "INFERE" ? "INFERENCE" : "RAW_DATA";
    ajouter("DELIVERY_EVIDENCE", ev.id, palier, resumer(`[${ev.methode}] ${ev.contenu}`));
  }

  // --- DeliveryQualityGate (jugement fort) — uniquement FINALIZED -------
  const qualityGates = deliverableVersionIds.length > 0
    ? await prisma.deliveryQualityGate.findMany({
        where: { deliverableVersionId: { in: deliverableVersionIds }, statut: "FINALIZED" },
        select: { id: true, resultat: true, criteresEvalues: true },
      })
    : [];
  const qualityResultats: ("PASS" | "FAIL" | "NOT_DETERMINABLE")[] = [];
  for (const q of qualityGates) {
    qualityResultats.push(q.resultat);
    ajouter("QUALITY_GATE", q.id, "VERIFIED_RESULT", resumer(`${q.resultat} — ${q.criteresEvalues}`));
  }

  // --- OutcomeAssessment courant (jugement métier autoritatif) ----------
  const outcome = await prisma.outcomeAssessment.findFirst({
    where: { missionId, supersededBy: null },
    select: { id: true, overallStatus: true, expectedOutcome: true },
  });
  if (outcome) {
    ajouter("OUTCOME_ASSESSMENT", outcome.id, "VERIFIED_RESULT", resumer(`Outcome ${outcome.overallStatus}${outcome.expectedOutcome ? ` (attendu: ${outcome.expectedOutcome})` : ""}`));
  }

  // --- FinancialResults (résultat économique) ---------------------------
  const financialResults = await prisma.financialResult.findMany({
    where: { missionId },
    select: { id: true, resultatGlobal: true, revenueProvenance: true, costProvenance: true },
    orderBy: { calculatedAt: "desc" },
  });
  for (const fr of financialResults) {
    // Un FinancialResult déclaré (DECLARE) reste une déclaration, jamais
    // promu VERIFIED (contrat A34 §7/§8) — même si VERIFIE sur l'un des
    // deux montants, seul VERIFIE sur LES DEUX justifie VERIFIED_RESULT.
    const toutVerifie = fr.revenueProvenance === "VERIFIE" && fr.costProvenance === "VERIFIE";
    ajouter("FINANCIAL_RESULT", fr.id, toutVerifie ? "VERIFIED_RESULT" : "DECLARATION", resumer(`Résultat ${fr.resultatGlobal}`));
  }
  // IMPORTANT (contrat A34 §7) : FinancialResult.resultatGlobal=LOSS
  // documente UN RÉSULTAT, jamais une cause — classification.ts ne doit
  // jamais en déduire "la cause de la perte était X".
  const financialResultGlobal = financialResults[0]?.resultatGlobal ?? null;

  return {
    missionId,
    clientId: mission.clientId,
    profilId: mission.profilId,
    pointeurs,
    outcomeStatut: outcome?.overallStatus ?? null,
    financialResultGlobal,
    qualityResultats,
  };
}
