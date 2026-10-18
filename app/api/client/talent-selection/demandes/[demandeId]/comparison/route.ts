import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { idPublicIngenieur } from "@/lib/talent/engineer-public-id";
import { evaluationVisiblePour } from "@/lib/interview/evaluation";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §15, Design Contract §12. Vue de lecture PURE — aucun nouveau modèle
// persisté (même pattern que lib/client-solution/comparaison.ts). Agrège,
// par candidat sélectionné : critères du besoin source (ClientNeedFait, si
// la DemandeTalent en a un — sourceNeedId reste nullable, inchangé),
// InterviewEvaluation(s) visibles par ce Client, disponibilité. Ne génère
// JAMAIS un "meilleur candidat" automatique — présente les faits côte à
// côte, point final (invariant verrouillé §9).
//
// CORRECTIF P0 (audit §12.3) — CTO Validation §5, condition non négociable
// 2 : "score/confiance/motifs ne sont JAMAIS sérialisés dans la réponse
// [d'une route Client]." Le champ `matching` (qui exposait `score`/
// `confiance`/`motifs` bruts) est retiré ; seule une projection qualitative
// (`explications: {critere, detail}[]`, sans `poids` numérique) subsiste —
// même discipline que le correctif appliqué à la route shortlist voisine.
export async function GET(_req: NextRequest, { params }: { params: { demandeId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findFirst({
    where: { id: params.demandeId, clientId: session.clientId },
    include: { sourceNeed: { include: { faits: { where: { statutActivite: "ACTIVE" } } } } },
  });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  }

  const selections = await prisma.candidateSelection.findMany({
    where: { demandeTalentId: params.demandeId },
    include: {
      shortlistEntree: { include: { profil: { select: { id: true, disponibilite: true, seniorite: true, anneesExperience: true } } } },
      interviews: { include: { evaluations: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const candidats = selections.map((selection) => {
    const evaluations = selection.interviews
      .flatMap((interview) => interview.evaluations)
      .filter((evaluation) => evaluationVisiblePour(evaluation, { role: "CLIENT" }));

    // `motifs` (MotifScore[] = {critere, poids, detail}[]) n'est JAMAIS
    // exposé tel quel : seul le texte qualitatif est projeté, jamais
    // `poids` (numérique) ni `score`/`confiance`.
    const motifsBruts = Array.isArray(selection.shortlistEntree.motifs)
      ? (selection.shortlistEntree.motifs as { critere?: unknown; detail?: unknown }[])
      : [];
    const explications = motifsBruts
      .filter((m) => typeof m.critere === "string" && typeof m.detail === "string")
      .map((m) => ({ critere: m.critere as string, detail: m.detail as string }));

    return {
      selectionId: selection.id,
      statut: selection.statut,
      ingenieurId: idPublicIngenieur(selection.shortlistEntree.profil.id),
      seniorite: selection.shortlistEntree.profil.seniorite,
      anneesExperience: selection.shortlistEntree.profil.anneesExperience ?? null,
      disponibilite: selection.shortlistEntree.profil.disponibilite,
      explications,
      evaluations,
      nombreEntretiens: selection.interviews.length,
    };
  });

  return NextResponse.json({
    demandeId: params.demandeId,
    besoin: demande.sourceNeed ? { id: demande.sourceNeed.id, titre: demande.sourceNeed.titre, faits: demande.sourceNeed.faits } : null,
    candidats,
  });
}
