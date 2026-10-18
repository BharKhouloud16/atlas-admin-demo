import { Prisma } from "@prisma/client";
import type { InterviewParticipantRole, RecommandationEvaluation } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// AppreciationCritere n'est jamais un champ scalaire d'un modèle (il ne
// vit qu'à l'intérieur du Json `criteres`) — Prisma ne génère donc pas de
// type exporté pour lui ; défini ici localement, valeurs identiques à
// l'enum déclaré dans prisma/schema.prisma.
type AppreciationCritere = "POSITIF" | "NEUTRE" | "NEGATIF";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §1.4, §9. Append-only via supersedesId (pattern exact de
// lib/financial-result/financial-result.ts) — jamais une réécriture.
// Invariant verrouillé : AUCUNE InterviewEvaluation ne déclenche jamais
// une CandidateFinalDecision — ce module n'importe et n'appelle jamais
// rien du domaine candidate-decision.
//
// RBAC : contrôlé exclusivement par l'appelant (route API). `evaluateurRole`
// n'est JAMAIS accepté en paramètre depuis l'appelant — il est dérivé ici
// du InterviewParticipant réel (email + statutInvitation: ACCEPTEE), pour
// qu'aucun appelant ne puisse falsifier le rôle qui détermine la
// visibilité (§10).

export class InterviewIntrouvableError extends Error {
  constructor() {
    super("INTERVIEW_INTROUVABLE");
  }
}

export class ParticipantNonAccepteError extends Error {
  constructor() {
    super("PARTICIPANT_NON_ACCEPTE");
  }
}

export class CriteresInvalidesError extends Error {
  constructor() {
    super("CRITERES_INVALIDES");
  }
}

export class RecommandationInvalideError extends Error {
  constructor() {
    super("RECOMMANDATION_INVALIDE");
  }
}

export class SupersedesIntrouvableError extends Error {
  constructor() {
    super("SUPERSEDES_INTROUVABLE");
  }
}

export class SupersedesAutreEvaluateurError extends Error {
  constructor() {
    super("SUPERSEDES_AUTRE_EVALUATEUR");
  }
}

export class DejaSupersedeError extends Error {
  constructor() {
    super("DEJA_SUPERSEDE");
  }
}

export class InterviewEvaluationIntrouvableError extends Error {
  constructor() {
    super("INTERVIEW_EVALUATION_INTROUVABLE");
  }
}

const APPRECIATIONS_VALIDES: AppreciationCritere[] = ["POSITIF", "NEUTRE", "NEGATIF"];
const RECOMMANDATIONS_VALIDES: RecommandationEvaluation[] = ["RECOMMANDE", "RECOMMANDE_AVEC_RESERVES", "NON_RECOMMANDE"];

// §1.4, Design Contract §13 — petit vocabulaire fermé et documenté : les 8
// facteurs réels de Matching V2 (lib/talent/matching.ts, labels exacts des
// FacteursMatching) + le petit set qualitatif non-technique explicitement
// cité ("communication", "motivation") — jamais une nouvelle taxonomie de
// compétences techniques. Point de définition unique, importé par les
// routes Client et Admin d'évaluation plutôt que dupliqué.
export const VOCABULAIRE_CRITERES_EVALUATION = [
  "Compétences",
  "Séniorité",
  "Disponibilité",
  "Budget / TJM",
  "Expérience",
  "Secteur / contexte",
  "Mobilité",
  "Localisation",
  "Communication",
  "Motivation",
] as const;

export type CritereEvaluation = { critere: string; observation: string; appreciation: AppreciationCritere };

// criteres est un vocabulaire fermé (facteurs Matching V2 + set qualitatif
// documenté, §1.4) — ce module valide la FORME uniquement (jamais une
// nouvelle taxonomie technique créée ici) ; la liste des valeurs
// autorisées pour `critere` est fournie par l'appelant (route API) via
// `vocabulaireAutorise`, jamais codée en dur dans ce service pur.
function validerCriteres(valeur: unknown, vocabulaireAutorise: readonly string[]): CritereEvaluation[] {
  if (!Array.isArray(valeur) || valeur.length === 0) throw new CriteresInvalidesError();
  return valeur.map((entree) => {
    if (
      typeof entree !== "object" ||
      entree === null ||
      typeof (entree as Record<string, unknown>).critere !== "string" ||
      typeof (entree as Record<string, unknown>).observation !== "string" ||
      !APPRECIATIONS_VALIDES.includes((entree as Record<string, unknown>).appreciation as AppreciationCritere)
    ) {
      throw new CriteresInvalidesError();
    }
    const critere = (entree as Record<string, unknown>).critere as string;
    if (!vocabulaireAutorise.includes(critere)) throw new CriteresInvalidesError();
    return {
      critere,
      observation: ((entree as Record<string, unknown>).observation as string).trim().slice(0, 1000),
      appreciation: (entree as Record<string, unknown>).appreciation as AppreciationCritere,
    };
  });
}

function validerRecommandation(valeur: unknown): RecommandationEvaluation {
  if (typeof valeur !== "string" || !RECOMMANDATIONS_VALIDES.includes(valeur as RecommandationEvaluation)) {
    throw new RecommandationInvalideError();
  }
  return valeur as RecommandationEvaluation;
}

export type CreationInterviewEvaluationParams = {
  interviewId: string;
  evaluateurEmail: string;
  criteres: unknown;
  vocabulaireAutorise: readonly string[];
  observations?: string;
  recommandation: unknown;
  commentairesLibres?: string;
  supersedesId?: string | null;
};

async function creerInterviewEvaluation(tx: Prisma.TransactionClient, params: CreationInterviewEvaluationParams) {
  const interview = await tx.interview.findUnique({ where: { id: params.interviewId }, include: { participants: true } });
  if (!interview) throw new InterviewIntrouvableError();

  // Ownership réelle : un InterviewParticipant ayant statutInvitation:
  // ACCEPTEE sur CET Interview — jamais une permission globale (§1.4).
  const participant = interview.participants.find((p) => p.emailParticipant === params.evaluateurEmail);
  if (!participant || participant.statutInvitation !== "ACCEPTEE") throw new ParticipantNonAccepteError();

  const evaluateurRole: InterviewParticipantRole = participant.role; // snapshot, jamais fourni par l'appelant

  const criteres = validerCriteres(params.criteres, params.vocabulaireAutorise);
  const recommandation = validerRecommandation(params.recommandation);

  let supersedesId: string | null = null;
  if (params.supersedesId) {
    const ancien = await tx.interviewEvaluation.findUnique({
      where: { id: params.supersedesId },
      select: { id: true, interviewId: true, evaluateurEmail: true },
    });
    // "Introuvable" et "appartient à un autre Interview" -> même erreur,
    // jamais une fuite d'existence IDOR (même doctrine que A29).
    if (!ancien || ancien.interviewId !== params.interviewId) throw new SupersedesIntrouvableError();
    if (ancien.evaluateurEmail !== params.evaluateurEmail) throw new SupersedesAutreEvaluateurError();

    const dejaSuperseded = await tx.interviewEvaluation.findFirst({ where: { supersedesId: params.supersedesId }, select: { id: true } });
    if (dejaSuperseded) throw new DejaSupersedeError();

    supersedesId = params.supersedesId;
  }

  return tx.interviewEvaluation.create({
    data: {
      interviewId: params.interviewId,
      evaluateurEmail: params.evaluateurEmail,
      evaluateurRole,
      criteres,
      observations: params.observations,
      recommandation,
      commentairesLibres: params.commentairesLibres,
      supersedesId,
    },
  });
}

const MAX_TENTATIVES = 3;

export async function creerInterviewEvaluationAvecRetry(params: CreationInterviewEvaluationParams) {
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    try {
      return await prisma.$transaction((tx) => creerInterviewEvaluation(tx, params));
    } catch (erreur) {
      if (erreur instanceof Prisma.PrismaClientKnownRequestError) {
        if (erreur.code === "P2034" && tentative < MAX_TENTATIVES - 1) continue;
        if (erreur.code === "P2002") throw new DejaSupersedeError();
      }
      throw erreur;
    }
  }
  throw new Error("ECHEC_INTERVIEW_EVALUATION_CONCURRENCE");
}

export async function listerInterviewEvaluations(interviewId: string) {
  return prisma.interviewEvaluation.findMany({ where: { interviewId }, orderBy: { createdAt: "asc" } });
}

export async function lireInterviewEvaluation(interviewId: string, evaluationId: string) {
  const evaluation = await prisma.interviewEvaluation.findUnique({ where: { id: evaluationId } });
  if (!evaluation || evaluation.interviewId !== interviewId) throw new InterviewEvaluationIntrouvableError();
  return evaluation;
}

// §1.4/§10 — visibilité par rôle d'évaluateur, verrouillée : une évaluation
// CLIENT est visible par ce Client + ADMIN ; toute autre
// (ADMIN_RECRUTEUR/INTERVIEWEUR_INTERNE/CANDIDAT) reste Admin-only. Jamais
// une visibilité croisée automatique entre évaluateurs, jamais visible par
// le candidat lui-même (§17).
export function evaluationVisiblePour(
  evaluation: { evaluateurRole: InterviewParticipantRole },
  viewer: { role: "ADMIN" | "CLIENT" | "INGENIEUR" }
): boolean {
  if (viewer.role === "ADMIN") return true;
  if (viewer.role === "CLIENT") return evaluation.evaluateurRole === "CLIENT";
  return false;
}
