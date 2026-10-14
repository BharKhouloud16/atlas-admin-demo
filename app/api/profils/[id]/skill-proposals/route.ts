import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// ATLAS — PHASE 2B-1 : MISSION SKILL PROPOSAL — lecture par profil.
//
// Route additive, purement en LECTURE (GET uniquement) : le mandat
// d'implémentation n'énumère explicitement que des routes scopées par
// Mission (POST/GET .../missions/[id]/skill-proposals), mais la console
// Admin (section 17 du mandat, app/admin/profils/[id]/page.tsx) doit
// afficher "Propositions de compétences" pour un PROFIL — potentiellement
// à travers plusieurs missions. Ajout minimal et sûr (aucune mutation,
// même RBAC Admin-only que le reste du module Skill Graph) plutôt qu'un
// blocage complet de l'implémentation pour ce seul point — voir rapport
// final, section "décisions non couvertes explicitement par le mandat".
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const profil = await prisma.profil.findUnique({ where: { id: params.id } });
  if (!profil) {
    return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });
  }

  const propositions = await prisma.missionSkillProposal.findMany({
    where: { profilId: params.id },
    include: { mission: { select: { id: true, repere: true, statut: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ profilId: params.id, propositions });
}
