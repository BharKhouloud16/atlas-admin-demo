import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { listerSolutionsExistantes } from "@/lib/client-solution/generation";
import { construireContexteDecisionnel } from "@/lib/decision-context";

// COMPANY ATLAS — V2.1-C : C3 Solution Intelligence — vue Admin.
//
// Réservé ADMIN, même patron que /api/talent/besoins/[id] (pas
// d'isolation clientId — vue transverse). Lecture seule : ne déclenche
// jamais de génération (réservé au parcours Client, seul déclencheur
// légitime) — renvoie uniquement les SolutionOption déjà persistées, qui
// sont déjà Client-safe (aucune donnée supplémentaire à filtrer ici : rien
// de plus sensible n'est jamais écrit dans SolutionOption, voir
// lib/client-solution/adapter.ts).
//
// DB-05 — Decision Context UI (08/10/2026) : enrichissement additif,
// strictement consultatif, exactement selon le même patron que A36.2.3
// sur la route Client (GET /api/client/besoins/[id]/solutions, inchangée)
// — jamais un deuxième endpoint DecisionContext, jamais une modification
// de lib/decision-context/* (A36.1, inchangé). `decisionEntityId` est
// TOUJOURS l'id d'une ligne SolutionOption déjà persistée et déjà
// Client-safe (jamais needId, jamais une valeur fournie par l'appelant) :
// la DERNIÈRE DECISION si une décision existe (pour que l'Admin revoie
// exactement la connaissance consultée au moment de la décision réellement
// prise), sinon la DERNIÈRE RECOMMANDATION (pour revoir la proposition
// actuelle avant toute décision) — jamais les deux en même temps, jamais
// une agrégation. `null` si aucune des deux n'existe encore (contrat
// identique à la route Client : jamais un contexte artificiel).
//
// Volontairement AUCUN appel à lib/audit.ts::journaliser() ici (contrat
// DB-05 §13, "consultation par le backend ≠ clic UI ; ne change pas la
// sémantique de l'audit A36.2.4") — "decision.learning_consulted" reste
// scopé exclusivement au parcours Client réel (A36.2.3/A36.2.4, seul
// déclencheur légitime d'une décision) ; une revue interne Admin n'est
// jamais elle-même un fait de consultation décisionnelle au sens de ce
// contrat, et y ajouter un second point d'émission mélangerait deux
// sémantiques différentes dans le même journal.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const need = await prisma.clientNeed.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!need) {
    return NextResponse.json({ error: "Besoin introuvable" }, { status: 404 });
  }

  const lignes = await listerSolutionsExistantes(params.id);
  const options = lignes.filter((l) => l.niveau === "OPTION");
  const recommandations = lignes.filter((l) => l.niveau === "RECOMMANDATION");
  const decisions = lignes.filter((l) => l.niveau === "DECISION");

  const sujet = decisions[decisions.length - 1] ?? recommandations[recommandations.length - 1] ?? null;
  let decisionContext = null;
  if (sujet) {
    const contexte = await construireContexteDecisionnel("SOLUTION", sujet.id);
    decisionContext = {
      subjectId: sujet.id,
      subjectNiveau: sujet.niveau,
      status: contexte.status,
      learnings: contexte.learnings,
      conflicts: contexte.conflicts,
    };
  }

  return NextResponse.json({ options, recommandations, decisions, decisionContext });
}
