import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { lireCorpsJson } from "@/lib/api-errors";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { STATUTS_MISSION_CLOSE } from "@/lib/feuilles-de-temps";

// Clôture d'une mission par l'Admin (V1) : « En cours » → « Terminée » ou
// « Annulée ». Aucune autre transition (une mission close ne se rouvre pas
// ici). Conséquences, déjà en place ailleurs : plus de saisie de CRA par
// l'Ingénieur (correction Admin tracée possible, voir
// app/api/feuilles-de-temps/correction), évaluation Client possible sur une
// mission « Terminée » (app/api/evaluations). Écriture conditionnée au
// statut lu et trace dans la même transaction.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/statut",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Mission",
      ressourceId: params.id,
      detail: "Tentative de changement de statut de mission par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const corps = (await lireCorpsJson(req)) as { statut?: unknown } | null;
  const statut = typeof corps?.statut === "string" ? corps.statut : "";
  if (!STATUTS_MISSION_CLOSE.includes(statut)) {
    return NextResponse.json({ error: `Statut invalide : ${STATUTS_MISSION_CLOSE.join(" ou ")} attendu.` }, { status: 400 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: params.id }, select: { id: true, statut: true, repere: true } });
  if (!mission) return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });
  if (mission.statut !== "En cours") {
    return NextResponse.json({ error: `Cette mission est déjà « ${mission.statut} ».` }, { status: 409 });
  }

  const maj = await prisma.$transaction(async (tx) => {
    const { count } = await tx.mission.updateMany({ where: { id: mission.id, statut: "En cours" }, data: { statut } });
    if (count === 0) return null;
    await tx.journalActivite.create({
      data: {
        acteurEmail: session.email,
        acteurRole: "ADMIN",
        action: "cloture_mission",
        cible: mission.id,
        detail: `Mission ${mission.repere ?? mission.id} : En cours → ${statut}.`,
      },
    });
    return tx.mission.findUniqueOrThrow({ where: { id: mission.id }, select: { id: true, statut: true } });
  });
  if (!maj) return NextResponse.json({ error: "Le statut de la mission a changé entre-temps. Rechargez la page." }, { status: 409 });
  return NextResponse.json(maj);
}
