import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { ProfilPourMatching, CompetenceGraphPourMatching } from "@/lib/talent/matching";
import { classerAvecRequirement, MAX_RESULTATS_BESOIN } from "@/lib/talent/besoin-matching";
import { idPublicIngenieur } from "@/lib/talent/engineer-public-id";
import type { RequirementStructure } from "@/lib/talent/requirement-analyzer";

// ATLAS LOT 15.5 — Client Requirement Builder, self-service matching
// (Parties F/G/H/I/J/L). Lecture seule : ne modifie ni ShortlistEntree ni
// DemandeTalent (contrairement à l'Admin Matching Engine V2, voir POST
// /api/talent/demandes/[id]/matching, jamais touché par ce lot) — chaque
// appel recalcule à la volée avec lib/talent/matching.ts::classerProfils,
// jamais un second moteur de scoring.
//
// Réservé au Client propriétaire (même isolation que .../besoin). L'IA
// (lib/talent/requirement-analyzer.ts) n'intervient qu'en amont, pour
// produire le besoin structuré — elle n'a ici aucun accès à la base des
// profils ni aux résultats : cette route lit directement Prisma, jamais une
// sortie d'agent IA (Partie L — "l'IA ne devient pas l'autorité sur les
// données ATLAS").
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès réservé aux clients" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findFirst({
    where: { id: params.id, clientId: session.clientId },
    select: { id: true, criteresStructures: true },
  });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable" }, { status: 404 });
  }
  if (!demande.criteresStructures) {
    return NextResponse.json(
      { error: "Aucun besoin structuré confirmé pour cette demande. Validez votre besoin avant de lancer le matching." },
      { status: 400 }
    );
  }
  const requirement = demande.criteresStructures as unknown as RequirementStructure;

  // Même filtre que le Matching Engine Admin (POST .../matching) : seuls
  // les profils au dossier exploitable sont proposés (voir /admin/profils).
  const profils = await prisma.profil.findMany({
    where: { cvValide: true },
    select: {
      id: true,
      competences: true,
      seniorite: true,
      disponibilite: true,
      cvValide: true,
      tjmEstime: true,
      anneesExperience: true,
      paysResidence: true,
    },
  });

  const lignesSkillGraph = await prisma.profilCompetence.findMany({
    where: { profilId: { in: profils.map((p) => p.id) } },
    include: { preuves: { orderBy: { createdAt: "asc" }, select: { source: true } } },
  });
  const graphParProfil = new Map<string, CompetenceGraphPourMatching[]>();
  for (const ligne of lignesSkillGraph) {
    const liste = graphParProfil.get(ligne.profilId) ?? [];
    liste.push({
      competence: ligne.competence,
      statut: ligne.statut,
      niveau: ligne.niveau,
      confiance: ligne.confiance,
      anneesExperience: ligne.anneesExperience,
      contexte: ligne.contexte,
      provenancePrincipale: ligne.preuves.length > 0 ? ligne.preuves[ligne.preuves.length - 1].source : null,
    });
    graphParProfil.set(ligne.profilId, liste);
  }

  const profilsAvecSkillGraph: ProfilPourMatching[] = profils.map((p) => ({
    ...p,
    competencesGraph: graphParProfil.get(p.id) ?? [],
  }));

  const candidats = classerAvecRequirement(profilsAvecSkillGraph, requirement);

  // Anonymisation stricte : jamais nom/prénom/email/téléphone/adresse, ni
  // aucun identifiant interne exploitable (voir idPublicIngenieur — dérivé
  // par HMAC, jamais l'id Prisma lui-même). Le score interne n'est jamais
  // affiché seul (Partie J) : chaque candidat porte l'explication factuelle
  // déjà produite par le Matching Engine (resultat.explication,
  // pointsForts/pointsFaibles), jamais un pourcentage nu.
  const resultats = candidats.map(({ profil, resultat }) => ({
    ingenieurId: idPublicIngenieur(profil.id),
    seniorite: profil.seniorite,
    anneesExperience: profil.anneesExperience ?? null,
    disponibilite: profil.disponibilite,
    localisation: profil.paysResidence ?? null,
    competencesCorrespondantes: resultat.pointsForts,
    pointsAmeliorer: resultat.pointsFaibles,
    informationsManquantes: resultat.informationsManquantes,
    explication: resultat.explication,
  }));

  return NextResponse.json({
    demandeId: demande.id,
    resultats,
    nombreResultats: resultats.length,
    maximum: MAX_RESULTATS_BESOIN,
    message: resultats.length === 0 ? "Aucun profil correspondant aux critères obligatoires n'a été trouvé." : null,
  });
}
