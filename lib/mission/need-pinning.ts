import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A18 : Mission Need Pinning + Solution Decision (05/10/2026).
//
// Fonction de VALIDATION uniquement — ne crée rien, ne résout aucun
// fallback (celui-ci reste dans lib/outcome/service.ts::resoudreNeedPinne,
// lecture seule, jamais invoqué à la création). Centralise les invariants
// de création d'une Mission pinnée (contrat A13 §3-§5) pour que
// app/api/missions/route.ts reste fin — même séparation que
// lib/mission/context-bridge.ts.
//
// RÈGLE : aucune incohérence n'est jamais corrigée silencieusement (jamais
// de repli sur le Need "courant", jamais une substitution automatique) —
// toute incohérence produit une erreur métier explicite, à charge de
// l'appelant (route API) de la traduire en 400/404 approprié.

export class NeedIntrouvableError extends Error {
  constructor() {
    super("NEED_INTROUVABLE");
  }
}

export class SolutionDecisionIntrouvableError extends Error {
  constructor() {
    super("SOLUTION_DECISION_INTROUVABLE");
  }
}

export class SolutionDecisionNiveauInvalideError extends Error {
  constructor() {
    super("SOLUTION_DECISION_NIVEAU_INVALIDE");
  }
}

export class SolutionDecisionNonFinaliseeError extends Error {
  constructor() {
    super("SOLUTION_DECISION_NON_FINALISEE");
  }
}

export class PinsIncoherentsError extends Error {
  constructor() {
    super("PINS_INCOHERENTS");
  }
}

export type PinsAVerifier = {
  clientId: string;
  needVersionId?: string | null;
  solutionDecisionId?: string | null;
};

export type PinsValides = {
  needVersionId: string | null;
  solutionDecisionId: string | null;
};

// Accepte aussi bien le client Prisma plein que le client de transaction —
// même discipline que lib/outcome/service.ts::ClientDb, jamais une
// duplication de requête entre les deux cas d'usage.
type ClientDb = Prisma.TransactionClient | typeof prisma;

export async function validerPinsMission(db: ClientDb, params: PinsAVerifier): Promise<PinsValides> {
  const needVersionId = params.needVersionId && params.needVersionId.trim().length > 0 ? params.needVersionId : null;
  const solutionDecisionId = params.solutionDecisionId && params.solutionDecisionId.trim().length > 0 ? params.solutionDecisionId : null;

  if (needVersionId) {
    const need = await db.clientNeed.findUnique({ where: { id: needVersionId }, select: { id: true, clientId: true } });
    // IDOR : "introuvable" et "mauvais tenant" produisent EXACTEMENT la même
    // erreur — jamais une distinction qui révélerait l'existence d'un Need
    // appartenant à un autre client (même discipline que MissionIntrouvableError,
    // A6.1, et les tests IDOR de A5.2).
    if (!need || need.clientId !== params.clientId) throw new NeedIntrouvableError();
  }

  let needPourDecision: string | null = null;
  if (solutionDecisionId) {
    const decision = await db.solutionOption.findUnique({
      where: { id: solutionDecisionId },
      select: { id: true, clientId: true, niveau: true, needId: true, decideParEmail: true, decideLe: true },
    });
    if (!decision || decision.clientId !== params.clientId) throw new SolutionDecisionIntrouvableError();
    if (decision.niveau !== "DECISION") throw new SolutionDecisionNiveauInvalideError();
    // Défensif — aucun chemin d'écriture actuel ne crée une ligne
    // niveau=DECISION sans ces deux champs, mais ne jamais le supposer sans
    // vérifier (contrat A13 §5).
    if (!decision.decideParEmail || !decision.decideLe) throw new SolutionDecisionNonFinaliseeError();
    needPourDecision = decision.needId;
  }

  // Cohérence croisée — uniquement quand les deux pins sont fournis (contrat
  // A13 §4/§5) : jamais une correction automatique, une incohérence est
  // toujours un refus explicite.
  if (needVersionId && needPourDecision && needPourDecision !== needVersionId) {
    throw new PinsIncoherentsError();
  }

  return { needVersionId, solutionDecisionId };
}
