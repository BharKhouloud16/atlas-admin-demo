import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ligneVersVue } from "./generation";
import { suggererCriteresDemande } from "@/lib/client-need/talent-bridge";
import { calculerSignatureSource } from "./signature";
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
  const need = await prisma.clientNeed.findFirst({
    where: { id: params.needId, clientId: params.clientId },
    include: { faits: true },
  });
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

  // LOT A — A5, gate A0 §10 : vérification explicite de `versionLien` avant
  // toute décision, en complément du contrôle "recommandation la plus
  // récente" ci-dessus (qui ne détecte qu'une régénération déjà survenue —
  // pas un Need modifié depuis la génération sans régénération encore
  // déclenchée). Même fonction pure que generation.ts, aucune nouvelle
  // règle : si la signature recalculée sur les faits ACTUELS du Need ne
  // correspond plus à celle enregistrée sur la recommandation, la décision
  // est refusée — jamais une décision silencieusement prise sur une base
  // obsolète.
  const signatureActuelle = calculerSignatureSource(suggererCriteresDemande(need.faits));
  if (recommandation.versionLien !== signatureActuelle) {
    return { ok: false, code: "RECOMMANDATION_OBSOLETE" };
  }

  // A5.2 — Need Versioning Core (gate A5.1 §23) : une recommandation dont
  // le Need source n'est plus la version courante de sa lignée
  // (needSuivantId !== null) est refusée, même si elle reste la plus
  // récente AU SEIN de ce needId et même si sa signature reste cohérente
  // avec les faits de cette version précise — un fork a eu lieu depuis,
  // décider ici serait décider sur une version devenue historique. Même
  // code métier que les deux contrôles ci-dessus, aucune nouvelle
  // sémantique introduite.
  if (need.needSuivantId !== null) {
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
      // LOT A — A5 : hérite du versionLien de la recommandation décidée
      // (déjà vérifié identique à signatureActuelle ci-dessus) — une
      // DECISION porte la version du Need au moment de la décision, jamais
      // NULL, jamais recalculée après coup.
      versionLien: recommandation.versionLien,
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
