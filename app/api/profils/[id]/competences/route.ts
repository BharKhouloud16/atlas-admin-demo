import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { TOUTES_COMPETENCES } from "@/lib/competences";
import {
  construireCompetencesDeclarees,
  construireCompetencesInferees,
  fusionnerCompetence,
  type EntreeSkillGraph,
  type ProfilCompetenceExistante,
} from "@/lib/talent/skill-graph";
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

  const profil = await prisma.profil.findUnique({ where: { id: params.id } });
  if (!profil) {
    return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });
  }

  // Seules les InfoCV VALIDÉES comptent comme source réelle (voir InfoCV.valide)
  // — une information non encore confirmée par l'ingénieur n'est pas une
  // preuve, ce n'est qu'un brouillon d'extraction.
  const infosCv = await prisma.infoCV.findMany({
    where: { profilId: params.id, valide: true, categorie: { in: ["competence", "experience"] } },
    select: { valeur: true },
  });
  const texteCv = infosCv.map((i) => i.valeur).filter(Boolean).join(". ");

  const declarees = construireCompetencesDeclarees(profil.competences);
  const inferees = await construireCompetencesInferees(texteCv, TOUTES_COMPETENCES);

  // Fusionne les deux sources par nom de compétence AVANT de les comparer à
  // l'existant en base : une compétence à la fois déclarée et retrouvée dans
  // le CV garde le statut le plus fort (DECLARE > INFERE) mais accumule les
  // deux preuves.
  const parCompetence = new Map<string, { entree: EntreeSkillGraph; preuves: EntreeSkillGraph["preuve"][] }>();
  for (const candidate of [...declarees, ...inferees]) {
    const existant = parCompetence.get(candidate.competence);
    if (!existant) {
      parCompetence.set(candidate.competence, { entree: candidate, preuves: [candidate.preuve] });
      continue;
    }
    const meilleure = fusionnerCompetence(
      { competence: existant.entree.competence, statut: existant.entree.statut, confiance: existant.entree.confiance, niveau: existant.entree.niveau },
      candidate
    );
    existant.entree = { ...existant.entree, statut: meilleure.statut, confiance: meilleure.confiance, niveau: meilleure.niveau };
    existant.preuves.push(candidate.preuve);
  }

  const existantes = await prisma.profilCompetence.findMany({
    where: { profilId: params.id },
    include: { preuves: { select: { source: true, detail: true } } },
  });
  const existantesParNom = new Map(existantes.map((e) => [e.competence, e]));

  let creees = 0;
  let misesAJour = 0;

  for (const [competence, { entree, preuves }] of parCompetence) {
    const existante = existantesParNom.get(competence) ?? null;
    const existanteLegere: ProfilCompetenceExistante | null = existante
      ? { competence: existante.competence, statut: existante.statut, confiance: existante.confiance, niveau: existante.niveau }
      : null;
    // Ne jamais faire régresser une compétence déjà VERIFIE (ou plus
    // "forte") par un Admin — voir fusionnerCompetence.
    const resultat = fusionnerCompetence(existanteLegere, entree);

    const profilCompetence = await prisma.profilCompetence.upsert({
      where: { profilId_competence: { profilId: params.id, competence } },
      create: {
        profilId: params.id,
        competence,
        statut: resultat.statut,
        confiance: resultat.confiance,
        niveau: resultat.niveau,
        anneesExperience: entree.anneesExperience,
        contexte: entree.contexte,
        secteur: entree.secteur,
      },
      update: {
        statut: resultat.statut,
        confiance: resultat.confiance,
        niveau: resultat.niveau,
      },
    });
    if (existante) misesAJour++;
    else creees++;

    // Preuves additives uniquement — jamais de suppression d'un historique
    // déjà là — et jamais de doublon exact (même source + même détail) pour
    // ne pas empiler la même preuve à chaque reconstruction.
    const preuvesExistantes = new Set((existante?.preuves ?? []).map((p) => `${p.source}::${p.detail ?? ""}`));
    for (const preuve of preuves) {
      const cle = `${preuve.source}::${preuve.detail ?? ""}`;
      if (preuvesExistantes.has(cle)) continue;
      preuvesExistantes.add(cle);
      await prisma.skillEvidence.create({
        data: { profilCompetenceId: profilCompetence.id, source: preuve.source, detail: preuve.detail },
      });
    }
  }

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "talent.skillgraph.recalcule",
    cible: `profil:${params.id}`,
    detail: `${creees} compétence(s) créée(s), ${misesAJour} mise(s) à jour, ${parCompetence.size} au total`,
  });

  const competences = await prisma.profilCompetence.findMany({
    where: { profilId: params.id },
    include: { preuves: { orderBy: { createdAt: "asc" } } },
    orderBy: { competence: "asc" },
  });

  return NextResponse.json({ profilId: params.id, competences: avecConfianceDetaillee(competences), creees, misesAJour });
}

// Attache `confianceDetaillee` (voir lib/talent/evidence-confidence.ts) à
// chaque ligne déjà chargée avec ses preuves — purement en mémoire, jamais
// une requête par compétence.
function avecConfianceDetaillee<
  T extends {
    competence: string;
    statut: StatutPreuveCompetence;
    niveau: number | null;
    confiance: NiveauConfiance;
    contexte: string | null;
    preuves: { source: SourcePreuveCompetence; detail: string | null; createdAt: Date }[];
  }
>(competences: T[]): (T & { confianceDetaillee: ReturnType<typeof calculerConfianceCompetences>[number] })[] {
  const confiances = calculerConfianceCompetences(competences);
  return competences.map((c, i) => ({ ...c, confianceDetaillee: confiances[i] }));
}
