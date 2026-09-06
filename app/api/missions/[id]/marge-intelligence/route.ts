import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { construireMarginIntelligence, type MissionPourMarge, type CraPourMarge } from "@/lib/finance/margin-intelligence";

// ATLAS FINANCE — Margin Intelligence V1 (Batch 10). SÉCURITÉ CRITIQUE :
// Admin uniquement — jamais CLIENT (même quand il est propriétaire de la
// mission), jamais INGENIEUR (même quand il est l'ingénieur affecté à la
// mission) : les coûts internes et la marge sont une donnée strictement
// interne Atlas (voir prisma/schema.prisma, enum Role). Lecture seule, une
// seule requête groupée (Mission + profil + feuillesDeTemps), aucun N+1,
// aucune écriture sur Mission/FeuilleDeTemps.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const [mission, hyp] = await Promise.all([
    prisma.mission.findUnique({
      where: { id: params.id },
      include: { profil: true, feuillesDeTemps: true },
    }),
    prisma.hypotheses.upsert({ where: { id: "singleton" }, update: {}, create: {} }),
  ]);
  if (!mission) {
    return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
  }

  const missionPourMarge: MissionPourMarge = {
    id: mission.id,
    tjmVente: mission.tjmVente,
    nbJours: mission.nbJours,
    margeCible: mission.margeCible,
    statut: mission.statut,
    profilType: mission.profil.type,
    profilMontantSaisi: mission.profil.montantSaisi,
  };
  const cras: CraPourMarge[] = mission.feuillesDeTemps.map((f) => ({
    mois: f.mois,
    joursTravailles: f.joursTravailles,
    statut: f.statut,
  }));

  const marginIntelligence = construireMarginIntelligence(missionPourMarge, cras, hyp);

  return NextResponse.json({ missionId: mission.id, repere: mission.repere, marginIntelligence });
}
