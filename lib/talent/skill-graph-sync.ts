import { Prisma, PrismaClient } from "@prisma/client";
import { construireCompetencesDeclarees, fusionnerCompetence, versCompetencesPourMatching } from "./skill-graph";

// ENGINEER PROFILE V2 — Phase Skills Foundation (ADR-001, audit d'architecture
// du même mandat) : ProfilCompetence devient la source de vérité unique des
// compétences ; Profil.competences[] devient une PROJECTION dérivée,
// recalculée à chaque écriture du Skill Graph — jamais écrite directement
// par une route applicative métier après cette phase.
//
// Pourquoi ce fichier existe séparément de lib/talent/skill-graph.ts : ce
// dernier reste STRICTEMENT pur et DB-free (voir son en-tête, testable sans
// base de données) — ce module-ci, à l'inverse, touche Prisma et orchestre
// les écritures. Il ne réimplémente AUCUNE règle métier : il appelle
// exclusivement construireCompetencesDeclarees/fusionnerCompetence/
// versCompetencesPourMatching déjà existantes, jamais une seconde logique
// de normalisation.
//
// RÈGLE DE COMPATIBILITÉ (ne pas casser lib/talent/matching.ts) : le
// fallback de competencesPourScoring() sur profil.competences reste
// intact et n'est PAS supprimé par cette phase — il redevient simplement
// un filet de sécurité historique, jamais emprunté en pratique une fois la
// projection toujours à jour (voir ADR-001).
type ClientOuTransaction = PrismaClient | Prisma.TransactionClient;

// Recalcule Profil.competences[] depuis l'état COURANT de ProfilCompetence
// pour ce profil — à appeler après TOUTE écriture susceptible de changer
// l'éligibilité d'une compétence (statut VERIFIE/DECLARE vs INFERE/INCONNU).
// Toujours un recalcul complet, jamais une mise à jour incrémentale : plus
// simple, sans risque d'oubli d'un cas limite, et le coût (une requête sur
// un nombre de compétences par profil toujours restreint) est négligeable.
export async function rafraichirProjectionCompetences(tx: ClientOuTransaction, profilId: string): Promise<string[]> {
  // orderBy déterministe : une projection stable, jamais dépendante de
  // l'ordre physique (non garanti) des lignes en base.
  const graphActuel = await tx.profilCompetence.findMany({
    where: { profilId },
    select: { competence: true, statut: true },
    orderBy: { competence: "asc" },
  });
  const projection = versCompetencesPourMatching(graphActuel);
  await tx.profil.update({ where: { id: profilId }, data: { competences: projection } });
  return projection;
}

// Applique une déclaration Ingénieur (checkbox du questionnaire de
// disponibilité, voir POST /api/ingenieur/disponibilite) directement sur le
// Skill Graph, puis rafraîchit la projection — remplace l'ancienne écriture
// brute de Profil.competences par cette route.
//
// RETRAIT D'UNE COMPÉTENCE (mandat, section 7) : une compétence retirée du
// formulaire ne fait JAMAIS disparaître sa ligne ProfilCompetence ni ses
// SkillEvidence (jamais de suppression, voir lib/talent/skill-graph.ts).
// Seule exception, volontairement étroite : si le statut courant est
// EXACTEMENT "DECLARE" (jamais VERIFIE — seule PATCH .../competences/[id]
// peut l'atteindre, voir ce fichier) ET que TOUTE l'évidence accumulée
// provient uniquement de la source PROFIL (aucune preuve MISSION/ADMIN/CV/
// CERTIFICATION/EVALUATION/ASSESSMENT), le statut régresse à INCONNU : la
// seule raison de ce statut disparaît avec la déclaration elle-même — ce
// n'est PAS une régression d'une preuve plus forte (interdite par
// fusionnerCompetence, jamais contournée ici), c'est le retrait de
// l'unique preuve existante. Dans tous les autres cas (VERIFIE, ou DECLARE
// avec une provenance additionnelle), rien n'est jamais modifié.
export async function appliquerDeclarationCompetences(
  tx: ClientOuTransaction,
  profilId: string,
  competencesDeclarees: string[]
): Promise<void> {
  const existantes = await tx.profilCompetence.findMany({
    where: { profilId },
    include: { preuves: { select: { source: true } } },
  });
  const existantesParNom = new Map(existantes.map((e) => [e.competence, e]));
  const nomsDeclares = new Set(competencesDeclarees);

  // 1) Upsert de chaque compétence nouvellement déclarée — même
  // construction/fusion que le recalcul Admin (POST /api/profils/[id]/
  // competences), jamais une seconde logique de merge.
  const candidats = construireCompetencesDeclarees(competencesDeclarees);
  for (const candidat of candidats) {
    const existante = existantesParNom.get(candidat.competence) ?? null;
    const resultat = fusionnerCompetence(
      existante
        ? { competence: existante.competence, statut: existante.statut, confiance: existante.confiance, niveau: existante.niveau }
        : null,
      candidat
    );
    const profilCompetence = await tx.profilCompetence.upsert({
      where: { profilId_competence: { profilId, competence: candidat.competence } },
      create: { profilId, competence: candidat.competence, statut: resultat.statut, confiance: resultat.confiance, niveau: resultat.niveau },
      update: { statut: resultat.statut, confiance: resultat.confiance, niveau: resultat.niveau },
    });
    // Preuve PROFIL additive, jamais dupliquée si une preuve PROFIL existe
    // déjà pour cette compétence (même convention de dédoublonnage que
    // POST /api/profils/[id]/competences).
    const preuveProfilDejaPresente = (existante?.preuves ?? []).some((p) => p.source === "PROFIL");
    if (!preuveProfilDejaPresente) {
      await tx.skillEvidence.create({ data: { profilCompetenceId: profilCompetence.id, source: "PROFIL", detail: null } });
    }
  }

  // 2) Retrait — voir règle détaillée en en-tête de fichier.
  for (const existante of existantes) {
    if (nomsDeclares.has(existante.competence)) continue;
    if (existante.statut !== "DECLARE") continue; // jamais toucher VERIFIE/INFERE/INCONNU
    const uniquementProfil = existante.preuves.every((p) => p.source === "PROFIL");
    if (!uniquementProfil) continue; // une autre provenance existe : jamais détruite
    await tx.profilCompetence.update({
      where: { id: existante.id },
      data: { statut: "INCONNU", confiance: "BASSE" },
    });
  }

  // 3) Projection recalculée depuis l'état FINAL du Skill Graph après les
  // étapes 1 et 2 ci-dessus — jamais depuis l'entrée brute du formulaire.
  await rafraichirProjectionCompetences(tx, profilId);
}
