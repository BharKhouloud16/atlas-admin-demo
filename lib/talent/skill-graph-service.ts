import { prisma } from "@/lib/prisma";
import { TOUTES_COMPETENCES } from "@/lib/competences";
import {
  construireCompetencesDeclarees,
  construireCompetencesInferees,
  fusionnerCompetence,
  type EntreeSkillGraph,
  type ProfilCompetenceExistante,
} from "@/lib/talent/skill-graph";

// ATLAS SKILL GRAPH V1 — service (Lot 11, 29/09/2026). Fonction métier
// réutilisable extraite TELLE QUELLE du corps de
// POST /api/profils/[id]/competences (comportement STRICTEMENT inchangé :
// même construction DECLARE+INFERE, même fusion via fusionnerCompetence,
// même dédoublonnage des preuves) — pour être appelée à la fois par cette
// route Admin ET par la finalisation du CV
// (app/api/ingenieur/cv/finaliser/route.ts), sans dupliquer cette logique
// ni faire d'appel HTTP interne entre les deux (mandat Lot 11, §2/§3).
//
// Idempotente et rejouable (GATE H, mandat Lot 11) : un appel répété sur le
// même profil ne crée jamais de doublon — `prisma.profilCompetence.upsert`
// et le dédoublonnage explicite des preuves (`source::detail` déjà vu)
// garantissent qu'un même appel, exécuté plusieurs fois avec les mêmes
// données sources, converge vers le même état final sans jamais empiler de
// preuve identique ni régresser un statut déjà plus fort (VERIFIE reste
// acquis, voir fusionnerCompetence).
//
// Ne journalise rien elle-même : c'est à l'appelant (route Admin, route de
// finalisation) de décider de l'acteur/action à consigner, ce service reste
// un pur service de données.
export type ResultatConstructionSkillGraph = {
  profilId: string;
  creees: number;
  misesAJour: number;
  total: number;
};

export async function construireSkillGraph(profilId: string): Promise<ResultatConstructionSkillGraph> {
  const profil = await prisma.profil.findUnique({ where: { id: profilId } });
  if (!profil) {
    throw new Error(`Skill Graph : profil introuvable (${profilId})`);
  }

  // Seules les InfoCV VALIDÉES comptent comme source réelle (voir InfoCV.valide)
  // — une information non encore confirmée par l'ingénieur n'est pas une
  // preuve, ce n'est qu'un brouillon d'extraction.
  const infosCv = await prisma.infoCV.findMany({
    where: { profilId, valide: true, categorie: { in: ["competence", "experience"] } },
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
    where: { profilId },
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
      where: { profilId_competence: { profilId, competence } },
      create: {
        profilId,
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

  return { profilId, creees, misesAJour, total: parCompetence.size };
}
