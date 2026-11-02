import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { refuserAccesAdmin } from "@/lib/security/acces-admin";

// LOT 2 (28/10/2026) — vue ADMIN des actions du Client sur les profils
// proposés pour un besoin (poursuivre, ne pas retenir, autres profils).
// Résout, pour l'Admin seulement, quel profil se cache derrière chaque
// proposition anonyme (SolutionOptionProfilInterne ou ShortlistEntree).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return refuserAccesAdmin(_req, session, "/api/talent/besoins/[id]/actions-client");
  }
  const need = await prisma.clientNeed.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!need) return NextResponse.json({ error: "Besoin introuvable" }, { status: 404 });

  const actions = await prisma.actionTalentClient.findMany({ where: { needId: need.id }, orderBy: { createdAt: "desc" } });
  const optionIds = actions.map((a) => a.solutionOptionId).filter((x): x is string => Boolean(x));
  const entreeIds = actions.map((a) => a.shortlistEntreeId).filter((x): x is string => Boolean(x));
  const [liens, entrees] = await Promise.all([
    prisma.solutionOptionProfilInterne.findMany({ where: { solutionOptionId: { in: optionIds } } }),
    prisma.shortlistEntree.findMany({ where: { id: { in: entreeIds } }, select: { id: true, profilId: true } }),
  ]);
  const profilIds = [...new Set([...liens.map((l) => l.profilId), ...entrees.map((e) => e.profilId)])];
  const profils = await prisma.profil.findMany({ where: { id: { in: profilIds } }, select: { id: true, nom: true, prenom: true } });
  const profilParOption = new Map(liens.map((l) => [l.solutionOptionId, l.profilId]));
  const profilParEntree = new Map(entrees.map((e) => [e.id, e.profilId]));
  const identite = new Map(profils.map((p) => [p.id, p]));

  return NextResponse.json({
    actions: actions.map((a) => {
      const profilId = (a.solutionOptionId && profilParOption.get(a.solutionOptionId)) || (a.shortlistEntreeId && profilParEntree.get(a.shortlistEntreeId)) || null;
      const p = profilId ? identite.get(profilId) : undefined;
      return {
        id: a.id,
        type: a.type,
        statut: a.statut,
        commentaire: a.commentaire,
        creeParEmail: a.creeParEmail,
        createdAt: a.createdAt,
        traiteParEmail: a.traiteParEmail,
        traiteLe: a.traiteLe,
        origine: a.solutionOptionId ? "MATCHING" : a.shortlistEntreeId ? "EQUIPE_ATLAS" : null,
        profil: p ? { id: p.id, nom: p.nom, prenom: p.prenom } : null,
      };
    }),
  });
}
