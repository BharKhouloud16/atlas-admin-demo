import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { construireMarginIntelligence, type MissionPourMarge, type CraPourMarge } from "@/lib/finance/margin-intelligence";

// ATLAS FINANCE — Margin Intelligence V1 (Lot 10). CRITIQUE DE SÉCURITÉ :
// Admin uniquement — jamais CLIENT (même quand il est propriétaire de la
// mission), jamais INGENIEUR (même quand il est l'ingénieur affecté à la
// mission) : les coûts internes et la marge sont une donnée strictement
// Atlas interne (voir prisma/schema.prisma, enum Role). Lecture seule, une
// seule requête groupée (Mission + profil + feuillesDeTemps), aucun N+1,
// aucune écriture sur Mission/FeuilleDeTemps.
//
// FIX B17 (08/09/2026) — `_req: Request` devient `req: NextRequest` pour
// journaliser IP et acteur. Deux ajouts (directive B17, sections 1 et 2) :
// - un refus RBAC (non-Admin) journalise désormais "rbac.acces_refuse",
//   même correctif de traçabilité que missions/clients — voir middleware.ts
//   (FIX B17) : ce contrôle était déjà là, mais inatteignable pour
//   CLIENT/INGENIEUR avant le fix middleware ci-dessus.
// - une lecture RÉUSSIE journalise "objet.consultation" (SUCCES) : c'est le
//   premier GET sensible instrumenté pour observer les accès aux objets
//   (directive B17, section 2) — cette route lit des coûts/marges internes
//   par mission, c'est la lecture la plus sensible du produit. Sert
//   désormais de source de donnée réelle au signal "accès anormal à des
//   objets" (lib/security/runtime-signals.ts), qui restait UNKNOWN en B16
//   faute d'un tel événement.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/marge-intelligence",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Mission",
      ressourceId: params.id,
      detail: "Tentative de lecture de la marge/coûts internes d'une mission par un rôle non-Admin.",
    });
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

  await enregistrerEvenementSecurite({
    correlationId: nouveauCorrelationId(),
    action: "objet.consultation",
    resultat: "SUCCES",
    severite: "INFO",
    contexteIp: adresseIp(req),
    contexteRoute: "/api/missions/[id]/marge-intelligence",
    acteurEmail: session.email,
    acteurRole: session.role,
    ressourceType: "Mission",
    ressourceId: mission.id,
    detail: `Consultation de la marge/coûts internes de la mission ${mission.id}.`,
  });

  return NextResponse.json({ missionId: mission.id, repere: mission.repere, marginIntelligence });
}
