import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { classerProfils, type ProfilPourMatching } from "@/lib/talent/matching";

// MATCHING — réservé à l'Admin (même principe que /admin/profils, jamais le
// Client ni l'Ingénieur : le classement expose seniorite/tjmEstime interne).
// POST calcule le classement et l'enregistre en ShortlistEntree (statut
// SUGGEREE) — jamais VALIDEE automatiquement : voir POST .../shortlist pour
// la validation humaine. GET relit juste le dernier calcul sans recalculer.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const demande = await prisma.demandeTalent.findUnique({ where: { id: params.id } });
  if (!demande) {
    return NextResponse.json({ error: "Demande introuvable" }, { status: 404 });
  }

  // Seuls les profils au dossier exploitable sont proposés au matching — un
  // ingénieur sans CV validé n'est de toute façon pas encore présentable à
  // un client (même règle que /admin/profils).
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

  // Les critères de la DemandeTalent (voir PATCH /api/talent/demandes/[id])
  // sont la source de vérité du matching — c'est l'Admin qui les a vérifiés/
  // corrigés avant de lancer ce calcul (voir /admin/talent/[id]).
  const classement = classerProfils(profils as ProfilPourMatching[], {
    competencesRecherchees: demande.competencesExtraites,
    senioriteSouhaitee: demande.senioriteSouhaitee,
    budgetTjmMax: demande.budgetTjmMax,
    anneesExperienceMin: demande.anneesExperienceMin,
    secteurActivite: demande.secteurActivite,
    localisation: demande.localisation,
    mobilite: demande.mobilite,
    disponibiliteSouhaitee: demande.disponibiliteSouhaitee,
  });

  // Ne retient que le top 10 en shortlist candidate — le Matching Engine
  // classe tout le monde, mais proposer 200 profils en "shortlist" n'aurait
  // aucun sens opérationnel.
  const top = classement.slice(0, 10);

  // Une décision humaine déjà prise (VALIDEE/REJETEE) ne doit jamais être
  // écrasée par un recalcul de score — on ne touche qu'aux entrées encore
  // SUGGEREE (ou pas encore créées).
  const dejaDecidees = new Set(
    (
      await prisma.shortlistEntree.findMany({
        where: { demandeId: demande.id, statut: { not: "SUGGEREE" } },
        select: { profilId: true },
      })
    ).map((e) => e.profilId)
  );

  await prisma.$transaction([
    ...top
      .filter((r) => !dejaDecidees.has(r.profilId))
      .map((r) =>
        prisma.shortlistEntree.upsert({
          where: { demandeId_profilId: { demandeId: demande.id, profilId: r.profilId } },
          create: {
            demandeId: demande.id,
            profilId: r.profilId,
            score: r.score,
            confiance: r.confiance,
            motifs: r.motifs,
            statut: "SUGGEREE",
          },
          update: { score: r.score, confiance: r.confiance, motifs: r.motifs },
        })
      ),
    prisma.demandeTalent.update({ where: { id: demande.id }, data: { statut: "EN_MATCHING" } }),
  ]);

  const shortlist = await prisma.shortlistEntree.findMany({
    where: { demandeId: demande.id },
    include: { profil: { select: { nom: true, prenom: true } } },
    orderBy: { score: "desc" },
  });

  return NextResponse.json({ demandeId: demande.id, shortlist });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const shortlist = await prisma.shortlistEntree.findMany({
    where: { demandeId: params.id },
    include: { profil: { select: { nom: true, prenom: true } } },
    orderBy: { score: "desc" },
  });

  return NextResponse.json({ demandeId: params.id, shortlist });
}
