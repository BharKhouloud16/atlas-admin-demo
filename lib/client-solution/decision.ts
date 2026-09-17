import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ligneVersVue } from "./generation";
import type { DonneesSolutionOption, SolutionOptionVue } from "./persistence-types";

// COMPANY ATLAS — V2.1-E : C3 Solution Intelligence — décision humaine.
//
// Append-only strict : une décision est toujours une NOUVELLE ligne
// SolutionOption (niveau=DECISION), jamais un UPDATE d'une ligne
// existante — même discipline que ClientProfileFact (V1) et SolutionOption
// (V2.1-A). Si le Client change d'avis, un nouvel appel crée une nouvelle
// DECISION ; l'ancienne reste en base, intacte, jamais supprimée.
//
// Seule une ligne niveau=RECOMMANDATION peut être décidée (jamais une
// simple OPTION directement, jamais un FAIT/SIGNAL) — voir architecture
// C3 validée. La RECOMMANDATION doit en outre être la plus récente pour ce
// besoin (la génération étant idempotente par signature de source, une
// RECOMMANDATION plus ancienne signifie que le besoin a changé depuis :
// décider dessus serait décider sur une base obsolète).

export type ResultatDecision =
  | { ok: true; decision: SolutionOptionVue }
  | { ok: false; code: "BESOIN_INTROUVABLE" }
  | { ok: false; code: "OPTION_INTROUVABLE" }
  | { ok: false; code: "NIVEAU_INVALIDE" }
  | { ok: false; code: "RECOMMANDATION_OBSOLETE" };

export async function deciderSolution(params: {
  needId: string;
  clientId: string;
  optionId: string;
  decideParEmail: string;
}): Promise<ResultatDecision> {
  const need = await prisma.clientNeed.findFirst({ where: { id: params.needId, clientId: params.clientId } });
  if (!need) return { ok: false, code: "BESOIN_INTROUVABLE" };

  const recommandation = await prisma.solutionOption.findFirst({
    where: { id: params.optionId, needId: params.needId, clientId: params.clientId },
  });
  if (!recommandation) return { ok: false, code: "OPTION_INTROUVABLE" };
  if (recommandation.niveau !== "RECOMMANDATION") return { ok: false, code: "NIVEAU_INVALIDE" };

  const derniereRecommandation = await prisma.solutionOption.findFirst({
    where: { needId: params.needId, niveau: "RECOMMANDATION" },
    orderBy: { createdAt: "desc" },
  });
  if (derniereRecommandation?.id !== recommandation.id) {
    return { ok: false, code: "RECOMMANDATION_OBSOLETE" };
  }

  const donneesSource = recommandation.donnees as unknown as DonneesSolutionOption;
  const donnees: DonneesSolutionOption = { ...donneesSource };

  const decision = await prisma.solutionOption.create({
    data: {
      needId: params.needId,
      clientId: params.clientId,
      niveau: "DECISION",
      typeSolution: recommandation.typeSolution,
      titre: recommandation.titre,
      justification: `Décision du client sur : ${recommandation.justification}`,
      donnees: donnees as unknown as Prisma.InputJsonValue,
      sourceOptionId: recommandation.id,
      decideParEmail: params.decideParEmail,
      decideLe: new Date(),
    },
  });

  return { ok: true, decision: ligneVersVue(decision) };
}

// Lecture seule de l'historique des décisions d'un besoin (plus récente en
// premier) — utilisée pour l'audit/traçabilité (V2.1-F) et pour permettre
// au Client de voir qu'il a changé d'avis sans jamais perdre l'historique.
export async function listerDecisions(needId: string): Promise<SolutionOptionVue[]> {
  const lignes = await prisma.solutionOption.findMany({
    where: { needId, niveau: "DECISION" },
    orderBy: { createdAt: "desc" },
  });
  return lignes.map(ligneVersVue);
}
