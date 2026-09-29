import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { niveauxHistoriques } from "@/lib/talent/skill-graph";
import { construireSkillGraph } from "@/lib/talent/skill-graph-service";
import { calculerConfianceCompetences } from "@/lib/talent/evidence-confidence";
import type { StatutPreuveCompetence, NiveauConfiance, SourcePreuveCompetence } from "@/lib/talent/skill-graph";

// ATLAS SKILL GRAPH V1 — réservé à l'Admin, comme /admin/profils et le
// Matching Engine (voir app/api/talent/demandes/[id]/matching/route.ts) :
// expose le niveau/l'expérience/le secteur estimés d'un ingénieur, des
// données jamais montrées au Client ni à l'Ingénieur lui-même à ce stade
// (même principe d'isolation que tjmEstime/marge interne).
//
// GET  : relit le Skill Graph déjà calculé pour ce profil (ne recalcule
//        rien).
// POST : (re)construit le Skill Graph à partir des données réellement
//        disponibles aujourd'hui — Profil.competences (déclaré) + InfoCV
//        validées de catégorie "competence"/"experience" (inféré via
//        l'AiProvider actif, voir lib/talent/skill-graph.ts) — sans jamais
//        faire régresser une compétence déjà VERIFIE par un Admin (voir
//        fusionnerCompetence).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const profil = await prisma.profil.findUnique({ where: { id: params.id } });
  if (!profil) {
    return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });
  }

  const competences = await prisma.profilCompetence.findMany({
    where: { profilId: params.id },
    include: { preuves: { orderBy: { createdAt: "asc" } } },
    orderBy: { competence: "asc" },
  });

  // ATLAS TALENT TRUST — Evidence Confidence (voir lib/talent/evidence-
  // confidence.ts) : calcul pur en mémoire à partir des compétences déjà
  // récupérées ci-dessus (aucune requête supplémentaire, pas de N+1) —
  // n'écrase jamais `statut`/`confiance` déjà stockés, ajoute seulement un
  // champ `confianceDetaillee` explicable pour chaque compétence.
  return NextResponse.json({ profilId: params.id, competences: avecConfianceDetaillee(competences) });
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  // LOT 11 — ATLAS SKILL INTELLIGENCE V1 : logique de construction extraite
  // dans lib/talent/skill-graph-service.ts (fonction métier réutilisable),
  // pour être partagée avec la finalisation du CV
  // (app/api/ingenieur/cv/finaliser/route.ts) sans appel HTTP interne ni
  // duplication — comportement strictement inchangé pour cette route.
  let resultat: Awaited<ReturnType<typeof construireSkillGraph>>;
  try {
    resultat = await construireSkillGraph(params.id);
  } catch {
    return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });
  }

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "talent.skillgraph.recalcule",
    cible: `profil:${params.id}`,
    detail: `${resultat.creees} compétence(s) créée(s), ${resultat.misesAJour} mise(s) à jour, ${resultat.total} au total`,
  });

  const competences = await prisma.profilCompetence.findMany({
    where: { profilId: params.id },
    include: { preuves: { orderBy: { createdAt: "asc" } } },
    orderBy: { competence: "asc" },
  });

  return NextResponse.json({
    profilId: params.id,
    competences: avecConfianceDetaillee(competences),
    creees: resultat.creees,
    misesAJour: resultat.misesAJour,
  });
}

// Attache `confianceDetaillee` (voir lib/talent/evidence-confidence.ts) et
// `niveauxHistoriques` (voir lib/talent/skill-graph.ts — ATLAS DYNAMIC SKILL
// GRAPH) à chaque ligne déjà chargée avec ses preuves — purement en
// mémoire, jamais une requête par compétence. `niveau` (sur la compétence)
// reste le CURRENT LEVEL, toujours fixé par un Admin ; `niveauxHistoriques`
// est la liste dérivée, purement informative, des niveaux observés au fil
// des preuves — jamais une source de vérité alternative.
function avecConfianceDetaillee<
  T extends {
    competence: string;
    statut: StatutPreuveCompetence;
    niveau: number | null;
    confiance: NiveauConfiance;
    contexte: string | null;
    preuves: { source: SourcePreuveCompetence; detail: string | null; createdAt: Date; niveau?: number | null }[];
  }
>(
  competences: T[]
): (T & {
  confianceDetaillee: ReturnType<typeof calculerConfianceCompetences>[number];
  niveauxHistoriques: ReturnType<typeof niveauxHistoriques>;
})[] {
  const confiances = calculerConfianceCompetences(competences);
  return competences.map((c, i) => ({
    ...c,
    confianceDetaillee: confiances[i],
    niveauxHistoriques: niveauxHistoriques(c.preuves.map((p) => ({ niveau: p.niveau ?? null, source: p.source, createdAt: p.createdAt }))),
  }));
}
