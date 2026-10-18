import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { missionSkillProposalModificationSchema, premierMessageZod } from "@/lib/validation";
import { TOUTES_COMPETENCES } from "@/lib/competences";

// ATLAS — PHASE 2B-1 : MISSION SKILL PROPOSAL — modification (D1).
//
// Une proposition reste modifiable UNIQUEMENT tant qu'elle est EN_ATTENTE —
// une fois VALIDEE ou REFUSEE, elle devient immuable (voir mandat D1) :
// aucun historique de versions n'est introduit ici, seul `updatedAt` +
// l'audit trace la modification (D1, "ne crée pas un historique complexe").
// Réservé à l'auteur Ingénieur de SA PROPRE proposition, ou à l'Admin (qui
// peut corriger n'importe quelle proposition EN_ATTENTE).
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; proposalId: string } }
) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "INGENIEUR")) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const proposition = await prisma.missionSkillProposal.findUnique({ where: { id: params.proposalId } });
  if (!proposition || proposition.missionId !== params.id) {
    return NextResponse.json({ error: "Proposition introuvable" }, { status: 404 });
  }

  if (session.role === "INGENIEUR") {
    // "Sa propre proposition" = celle qu'il a lui-même proposée — jamais
    // une proposition faite par l'Admin sur sa mission (même politique
    // IDOR : 404, jamais 403, pour ne pas confirmer l'existence).
    if (proposition.proposeParEmail !== session.email || proposition.profilId !== session.profilId) {
      return NextResponse.json({ error: "Proposition introuvable" }, { status: 404 });
    }
  }

  if (proposition.statut !== "EN_ATTENTE") {
    return NextResponse.json({ error: `Proposition déjà décidée (${proposition.statut}) — modification impossible.` }, { status: 409 });
  }

  const corps = await req.json().catch(() => ({}));
  const analyse = missionSkillProposalModificationSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const donnees = analyse.data;

  if (donnees.competence !== undefined && !TOUTES_COMPETENCES.includes(donnees.competence)) {
    return NextResponse.json({ error: "Compétence inconnue (voir lib/competences.ts)." }, { status: 400 });
  }

  const changements: string[] = [];
  const data: { competence?: string; niveauPropose?: number | null; contexte?: string | null } = {};
  if (donnees.competence !== undefined && donnees.competence !== proposition.competence) {
    changements.push(`competence: ${proposition.competence} -> ${donnees.competence}`);
    data.competence = donnees.competence;
  }
  if (donnees.niveauPropose !== undefined && donnees.niveauPropose !== proposition.niveauPropose) {
    changements.push(`niveauPropose: ${proposition.niveauPropose ?? "null"} -> ${donnees.niveauPropose ?? "null"}`);
    data.niveauPropose = donnees.niveauPropose;
  }
  if (donnees.contexte !== undefined && donnees.contexte !== proposition.contexte) {
    changements.push("contexte modifié");
    data.contexte = donnees.contexte;
  }

  const apres = Object.keys(data).length > 0
    ? await prisma.missionSkillProposal.update({ where: { id: proposition.id }, data })
    : proposition;

  if (changements.length > 0) {
    await journaliser({
      acteurEmail: session.email,
      acteurRole: session.role,
      action: "mission.skill_proposal.updated",
      cible: `proposal:${proposition.id}`,
      detail: `Mission ${proposition.missionId}, profil ${proposition.profilId} : ${changements.join(", ")}.`,
    });
  }

  return NextResponse.json(apres);
}
