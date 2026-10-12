import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { genererOuRecupererSolutions } from "@/lib/client-solution/generation";
import { construireContexteDecisionnel } from "@/lib/decision-context";
import { journaliser } from "@/lib/audit";

// COMPANY ATLAS — V2.1-C : C3 Solution Intelligence — API Client.
//
// GET déclenche (ou récupère, si déjà à jour — voir genererOuRecupererSolutions,
// idempotent) la génération des options de solution pour un ClientNeed
// VALIDÉ. Même discipline d'isolation que le reste de l'Espace Client :
// clientId toujours dérivé de la session, jamais du corps/params ; un
// besoin d'un autre client renvoie 404 (même patron que
// /api/client/besoins/[id], jamais une fuite d'existence).
//
// A36.2.3 — Premier consommateur réel du Decision Context (contrat A36/
// A36.1/A36.2/A36.2.2) : consulté EXCLUSIVEMENT APRÈS que
// genererOuRecupererSolutions() (inchangée, jamais appelée différemment)
// a produit sa RECOMMANDATION — jamais pendant la génération, jamais comme
// paramètre d'entrée du moteur (contrat A36.2 §6/§8). L'id utilisé est
// TOUJOURS `resultat.recommandation.id` (l'identifiant canonique déjà
// autorisé par le flux existant ci-dessus, jamais `params.id`/needId,
// jamais `sourceOptionId`, jamais une valeur fournie par le client) :
// la frontière d'autorisation reste entièrement celle déjà en place
// (session CLIENT + session.clientId + ownership du Need, vérifiés par
// genererOuRecupererSolutions avant que `resultat` n'existe) — ce bloc
// ne crée aucun second mécanisme RBAC, aucune mutation (Learning/
// SolutionOption/ClientNeed/Mission), aucune IA. `decisionContext` reste
// `null` si aucune RECOMMANDATION n'existe — jamais un contexte inventé.
//
// A36.2.4 — Traçabilité de CONSULTATION (contrat A36.2.4, "retrieved +
// consulted" UNIQUEMENT — jamais "used"/"adopted", ces deux notions
// resteraient à déclarer explicitement par une future décision humaine/
// ATLAS, hors périmètre ici). Émise via lib/audit.ts::journaliser(), la
// même infrastructure canonique déjà utilisée par A32/A34 — jamais un
// nouveau système d'audit, jamais une nouvelle table. Journalisée
// UNIQUEMENT quand un Decision Context a été réellement construit avec
// succès (recommandation présente ET construireContexteDecisionnel()
// n'a pas levé) — "consulted" est strictement un fait, jamais déduit
// d'une tentative ratée : si construireContexteDecisionnel() lève, cette
// ligne n'est jamais exécutée, aucun faux événement n'est créé (la
// requête échoue normalement avant d'y arriver, contrat A36.2.4 §6).
// `learningIds` provient EXCLUSIVEMENT de `contexte.learnings` déjà
// retourné par A36.1 (jamais une seconde requête Prisma, jamais une
// reconstruction) — aucun "winner" n'est jamais journalisé même en cas
// de CONFLICTING_CONTEXT (contrat A36.2.4 §9). `journaliser()` reste
// best-effort par son propre contrat existant (try/catch interne, voir
// lib/audit.ts) — aucune politique d'erreur supplémentaire n'est ajoutée
// ici (contrat A36.2.4 §13).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const resultat = await genererOuRecupererSolutions(params.id, session.clientId).catch((erreur: unknown) => {
    if (erreur instanceof Error && erreur.message === "BESOIN_INTROUVABLE") return null;
    throw erreur;
  });

  if (resultat === null) {
    return NextResponse.json({ error: "Besoin introuvable." }, { status: 404 });
  }

  let decisionContext = null;
  if (resultat.eligible && resultat.recommandation) {
    const contexte = await construireContexteDecisionnel("SOLUTION", resultat.recommandation.id);
    decisionContext = { status: contexte.status, learnings: contexte.learnings, conflicts: contexte.conflicts };

    const learningIds = contexte.learnings.map((l) => l.learningId);
    await journaliser({
      acteurEmail: session.email,
      acteurRole: session.role,
      action: "decision.learning_consulted",
      cible: `solution-option:${resultat.recommandation.id}`,
      detail: `Decision Context SOLUTION consulté pour la recommandation ${resultat.recommandation.id} (besoin ${params.id}, client ${session.clientId}) — status=${decisionContext.status}, learnings=[${learningIds.join(",")}].`,
    });
  }

  return NextResponse.json({ ...resultat, decisionContext });
}
