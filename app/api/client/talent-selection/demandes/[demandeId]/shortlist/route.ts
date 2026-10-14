import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { idPublicIngenieur } from "@/lib/talent/engineer-public-id";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §15. Lecture seule : ne modifie jamais ShortlistEntree (jamais un champ
// ajouté, jamais un statut modifié par ce lot). Filtre `statut: VALIDEE`
// appliqué en requête Prisma (pas en mémoire) — seule la décision Admin
// déjà existante (voir app/api/talent/demandes/[id]/shortlist/route.ts)
// rend une entrée visible ici.
//
// CORRECTIF P0 (audit docs/audits/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_AUDIT.md
// §12.3) — CTO Validation §5, condition non négociable 2 : "score/confiance/
// motifs ne sont JAMAIS sérialisés dans la réponse de cette route." Ces trois
// champs ne sont donc plus jamais inclus dans `resultats` ci-dessous.
// `orderBy: { score: "desc" }` reste légitime : le tri interne par score
// n'EXPOSE jamais la valeur elle-même dans la réponse JSON, seul l'ordre des
// candidats en résulte — ce que `CandidatAnonyme` fait déjà ailleurs (Top 5
// de `besoin/matcher`, jamais un score nu affiché, toujours un ordre +
// explication). `ShortlistEntree.motifs` (`MotifScore[]`, champ RÉELLEMENT
// stocké) est projeté en `explications: {critere, detail}[]` — `poids`
// (numérique) est explicitement retiré : aucun indicateur numérique de
// substitution n'est introduit, seul le texte qualitatif (`detail`) et le nom
// du critère sont exposés, cohérent avec `pointsForts`/`explication` de
// `CandidatAnonyme` (jamais un chiffre, toujours un fait qualitatif).
export async function GET(_req: NextRequest, { params }: { params: { demandeId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findFirst({
    where: { id: params.demandeId, clientId: session.clientId },
    select: { id: true },
  });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  }

  const entrees = await prisma.shortlistEntree.findMany({
    where: { demandeId: params.demandeId, statut: "VALIDEE" },
    include: {
      profil: { select: { id: true, seniorite: true, anneesExperience: true, disponibilite: true, paysResidence: true } },
      candidateSelections: { where: { statut: "ACTIVE" }, select: { id: true } },
    },
    orderBy: { score: "desc" },
  });

  const resultats = entrees.map((entree) => {
    // `motifs` (MotifScore[] = {critere, poids, detail}[]) n'est JAMAIS
    // exposé tel quel (champ interdit) : seul le texte qualitatif
    // (`critere`/`detail`) est projeté, jamais `poids` (numérique).
    const motifsBruts = Array.isArray(entree.motifs) ? (entree.motifs as { critere?: unknown; detail?: unknown }[]) : [];
    const explications = motifsBruts
      .filter((m) => typeof m.critere === "string" && typeof m.detail === "string")
      .map((m) => ({ critere: m.critere as string, detail: m.detail as string }));

    return {
      shortlistEntreeId: entree.id,
      ingenieurId: idPublicIngenieur(entree.profil.id),
      seniorite: entree.profil.seniorite,
      anneesExperience: entree.profil.anneesExperience ?? null,
      disponibilite: entree.profil.disponibilite,
      localisation: entree.profil.paysResidence ?? null,
      explications,
      dejaSelectionne: entree.candidateSelections.length > 0,
    };
  });

  return NextResponse.json({ demandeId: params.demandeId, resultats });
}
