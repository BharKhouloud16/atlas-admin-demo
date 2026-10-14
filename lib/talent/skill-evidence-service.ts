import type { Prisma, ProfilCompetence, SkillEvidence } from "@prisma/client";
import {
  fusionnerCompetence,
  niveauxHistoriques,
  type NiveauConfiance,
  type SourcePreuveCompetence,
  type StatutPreuveCompetence,
} from "./skill-graph";
import { calculerConfianceCompetence } from "./evidence-confidence";

// ATLAS — PHASE 2B-1 (28/09/2026). Cœur de création de preuve extrait TEL
// QUEL de POST /api/profils/[id]/competences/[competenceId]/preuves (comportement
// STRICTEMENT inchangé par rapport au code original de cette route — même
// création SkillEvidence, même fusionnerCompetence, même recalcul de
// confianceDetaillee/niveauxHistoriques) — pour être appelé à la fois par
// cette route ET par la validation d'une MissionSkillProposal (voir
// app/api/profils/[id]/skill-proposals/[proposalId]/route.ts), SANS
// DUPLIQUER cette logique (mandat Phase 2B-1, section 10).
//
// Volontairement PAS dans lib/talent/skill-graph.ts : ce module reste pur,
// déterministe, sans DB (voir son en-tête — "Pas de DB ici", testé sans
// Prisma dans tests/unit/skill-graph.spec.ts). Cette fonction touche la
// base, elle vit donc à côté, dans un fichier de service dédié — même
// séparation déjà en place ailleurs dans ce dépôt entre calcul pur
// (lib/talent/evidence-confidence.ts) et écriture (routes API).
//
// Le premier paramètre accepte indifféremment le client Prisma global OU un
// client de transaction (Prisma.TransactionClient) — INDISPENSABLE pour
// que la validation d'une MissionSkillProposal (mandat section 8, "UNE
// transaction") puisse appeler cette fonction SANS sortir de sa propre
// transaction : passer `tx` ici la garde atomique avec le verrouillage et
// la mise à jour de la proposition ; passer `prisma` (le singleton) donne
// exactement le comportement non transactionnel déjà en place pour la
// route /preuves existante — comportement inchangé pour cet appelant.
export type PrismaLike = Prisma.TransactionClient;

export type ExistanteCompetencePourPreuve = {
  id: string;
  competence: string;
  statut: StatutPreuveCompetence;
  confiance: NiveauConfiance;
  niveau: number | null;
  anneesExperience: number | null;
  contexte: string | null;
  secteur: string | null;
};

export type CreerPreuveCompetenceParams = {
  source: SourcePreuveCompetence;
  detail: string | null;
  niveauObserve: number | null;
  statutPropose?: StatutPreuveCompetence;
};

export type ResultatCreerPreuveCompetence = {
  profilCompetence: ProfilCompetence;
  preuves: SkillEvidence[];
  confianceDetaillee: ReturnType<typeof calculerConfianceCompetence>;
  niveauxHistoriques: ReturnType<typeof niveauxHistoriques>;
  skillEvidenceCreee: SkillEvidence;
};

export async function creerPreuveCompetence(
  client: PrismaLike,
  existante: ExistanteCompetencePourPreuve,
  params: CreerPreuveCompetenceParams
): Promise<ResultatCreerPreuveCompetence> {
  // La nouvelle preuve est TOUJOURS créée, quelle que soit la suite —
  // l'historique s'accumule, il ne se substitue jamais à ce qui précède
  // (identique au comportement original de la route /preuves).
  const skillEvidenceCreee = await client.skillEvidence.create({
    data: {
      profilCompetenceId: existante.id,
      source: params.source,
      detail: params.detail ?? null,
      niveau: params.niveauObserve ?? null,
    },
  });

  // Fusion éventuelle du statut/niveau proposés avec l'existant — jamais de
  // régression (voir fusionnerCompetence, lib/talent/skill-graph.ts).
  const resultat = fusionnerCompetence(
    { competence: existante.competence, statut: existante.statut, confiance: existante.confiance, niveau: existante.niveau },
    {
      competence: existante.competence,
      statut: params.statutPropose ?? existante.statut,
      confiance: existante.confiance,
      niveau: params.niveauObserve ?? null,
      anneesExperience: existante.anneesExperience,
      contexte: existante.contexte,
      secteur: existante.secteur,
      preuve: { source: params.source, detail: params.detail ?? null, niveau: params.niveauObserve ?? null },
    }
  );

  const profilCompetence = await client.profilCompetence.update({
    where: { id: existante.id },
    data: { statut: resultat.statut, confiance: resultat.confiance, niveau: resultat.niveau },
  });

  const preuves = await client.skillEvidence.findMany({
    where: { profilCompetenceId: existante.id },
    orderBy: { createdAt: "asc" },
  });

  const confianceDetaillee = calculerConfianceCompetence({
    competence: profilCompetence.competence,
    statut: profilCompetence.statut,
    niveau: profilCompetence.niveau,
    confiance: profilCompetence.confiance,
    contexte: profilCompetence.contexte,
    preuves,
  });

  return {
    profilCompetence,
    preuves,
    confianceDetaillee,
    niveauxHistoriques: niveauxHistoriques(preuves.map((p) => ({ niveau: p.niveau, source: p.source, createdAt: p.createdAt }))),
    skillEvidenceCreee,
  };
}
