import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { construireSignauxTrustClient } from "@/lib/talent/client-trust-signals";

// ENGINEER PROFILE V2 — Lot 6 : Trust Client (MVP).
//
// Voir le contrat produit validé ("FINAL PRODUCT CONTRACT") : ce endpoint
// construit une PROJECTION Client-safe directement en base (SELECT
// explicite), jamais un objet Profil complet filtré après coup. Même
// isolation que le reste de l'Espace Client (voir
// app/api/client/besoins/[id]/route.ts) : l'id de l'URL est une Mission,
// jamais un profilId — la Mission doit appartenir à session.clientId,
// sinon 404 (jamais 403, jamais un tableau vide : aucune fuite d'existence).
//
// DONNÉES JAMAIS CHARGÉES PAR CETTE ROUTE (absentes du SELECT, pas
// seulement non retournées) : CV, TJM, ShortlistEntree/matching, Talent
// Trust, SkillEvidence.detail, Evaluation.commentaire/note individuelle,
// tout Mission autre que celle demandée (id/clientId/description jamais
// sélectionnés pour les missions utilisées au calcul de mobilisation — seul
// leur `statut` est lu, pour un booléen agrégé).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const mission = await prisma.mission.findUnique({
    where: { id: params.id },
    select: { id: true, clientId: true, profilId: true },
  });
  if (!mission || mission.clientId !== session.clientId) {
    return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });
  }

  // Compétences éligibles (DECLARE/VERIFIE uniquement) SÉLECTIONNÉES EN
  // BASE — jamais toutes les compétences puis un filtre TypeScript (voir
  // contrat, §2 : "Cette exclusion doit être faite au niveau de la
  // requête"). `niveau`/`confiance`/`contexte`/`secteur` jamais sélectionnés.
  const competences = await prisma.profilCompetence.findMany({
    where: { profilId: mission.profilId, statut: { in: ["DECLARE", "VERIFIE"] } },
    select: {
      id: true,
      competence: true,
      statut: true,
      // Mobilisation : uniquement l'existence d'un lien vers une Mission
      // TERMINÉE — aucun champ de Mission autre que `statut` n'est lu ici,
      // jamais un id/clientId/description qui pourrait identifier un tiers.
      missions: { where: { mission: { statut: "Terminée" } }, select: { missionId: true }, take: 1 },
    },
  });

  const signaux = construireSignauxTrustClient(
    competences.map((c) => ({ competence: c.competence, statut: c.statut, mobiliseeEnMission: c.missions.length > 0 }))
  );

  return NextResponse.json({ engineerId: mission.profilId, signals: signaux });
}
