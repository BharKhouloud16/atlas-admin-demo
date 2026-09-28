import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { missionSkillProposalSchema, premierMessageZod } from "@/lib/validation";
import { TOUTES_COMPETENCES } from "@/lib/competences";

// ATLAS — PHASE 2B-1 : MISSION SKILL PROPOSAL (28/09/2026).
//
// Première étape du pont MISSION -> PROPOSITION -> DÉCISION HUMAINE ->
// SkillEvidence (voir prisma/schema.prisma, MissionSkillProposal). Une
// Mission ne prouve JAMAIS automatiquement qu'une compétence est maîtrisée
// — cette route ne crée qu'une PROPOSITION, un objet de workflow mutable
// (voir PATCH .../[proposalId]/route.ts pour la modification EN_ATTENTE et
// app/api/profils/[id]/skill-proposals/[proposalId]/route.ts pour la seule
// route capable de créer une SkillEvidence à partir d'elle).
//
// Une Mission En cours, Terminée ou Annulée peut recevoir une proposition
// (voir audit Phase 2B-1, H4/H5) : rien dans le modèle produit actuel ne
// justifie d'interdire de documenter, après coup, quelles compétences ont
// été mobilisées sur une mission déjà terminée ou annulée (le Reality
// Check Phase 2A++ a déjà montré qu'une mission "Annulée" ne signifie pas
// nécessairement "aucun travail n'a eu lieu"). Bloquer sur le statut
// Mission introduirait une règle non justifiée par une donnée réelle.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR")) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: params.id } });
  if (!mission) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }
  if (session.role === "INGENIEUR" && mission.profilId !== session.profilId) {
    // Jamais 403 ici : révélerait l'existence de la mission d'un autre
    // ingénieur (même politique IDOR que le reste du Skill Graph).
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  const propositions = await prisma.missionSkillProposal.findMany({
    where: { missionId: params.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ missionId: params.id, propositions });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR")) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const corps = await req.json().catch(() => ({}));
  const analyse = missionSkillProposalSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const donnees = analyse.data;

  if (!TOUTES_COMPETENCES.includes(donnees.competence)) {
    return NextResponse.json({ error: "Compétence inconnue (voir lib/competences.ts)." }, { status: 400 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: params.id } });
  if (!mission) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }
  if (session.role === "INGENIEUR" && mission.profilId !== session.profilId) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  try {
    // profilId TOUJOURS dérivé de mission.profilId côté serveur — jamais
    // accepté depuis le body (élimine structurellement tout IDOR par
    // profilId falsifié, voir mandat section 3).
    const proposition = await prisma.missionSkillProposal.create({
      data: {
        missionId: mission.id,
        profilId: mission.profilId,
        competence: donnees.competence,
        niveauPropose: donnees.niveauPropose ?? null,
        contexte: donnees.contexte ?? null,
        proposeParEmail: session.email,
        proposeParRole: session.role,
      },
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: session.role,
      action: "mission.skill_proposal.created",
      cible: `proposal:${proposition.id}`,
      detail: `Mission ${mission.id}, profil ${mission.profilId} : proposition "${donnees.competence}" (niveau proposé ${donnees.niveauPropose ?? "non renseigné"}) par ${session.email}.`,
    });

    return NextResponse.json(proposition, { status: 201 });
  } catch (e) {
    // D2 — au plus une proposition EN_ATTENTE active par (missionId,
    // competence), garantie par l'index unique PARTIEL ajouté en migration
    // (voir prisma/migrations/.../migration.sql) — jamais un simple
    // findFirst() puis create() hors transaction, qui laisserait passer
    // deux créations concurrentes.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Une proposition en attente existe déjà pour cette compétence sur cette mission." },
        { status: 409 }
      );
    }
    throw e;
  }
}
