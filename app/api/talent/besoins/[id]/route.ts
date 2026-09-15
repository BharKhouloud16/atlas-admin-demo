import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { dernierFaitParCle } from "@/lib/client-need/faits";
import { instancesActivesParCle } from "@/lib/client-profile/faits";
import { suggererCriteresDemande, evaluerEligibiliteBesoin } from "@/lib/client-need/talent-bridge";

// COMPANY ATLAS — LOT 5 : Client Intelligence → Talent Bridge (15/09/2026).
//
// Réservé ADMIN. Agrège, pour un ClientNeed donné : le besoin complet
// (texte original + faits, jamais recopiés ni réécrits), l'identité du
// client, les faits ACTIFS de son ClientProfile (LOT 4, contexte durable —
// réutilise instancesActivesParCle/dernierFaitParCle tels quels, aucune
// seconde implémentation), l'éligibilité (LOT 3 : statut VALIDE) et une
// SUGGESTION de critères DemandeTalent (lib/client-need/talent-bridge.ts,
// jamais une création). Vue transverse Admin (pas d'isolation clientId) —
// même principe que GET /api/talent/demandes pour un ADMIN.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const need = await prisma.clientNeed.findUnique({
    where: { id: params.id },
    include: {
      faits: true,
      client: { select: { id: true, nom: true, secteur: true, pays: true } },
      demandeTalentCreee: { select: { id: true } },
    },
  });
  if (!need) {
    return NextResponse.json({ error: "Besoin introuvable" }, { status: 404 });
  }

  const profile = await prisma.clientProfile.findUnique({
    where: { clientId: need.clientId },
    include: { faits: true },
  });
  const contexteActuel = profile ? dernierFaitParCle(profile.faits.filter((f) => f.cle === "CONTEXTE_ACTIVITE")) : new Map();
  const actifsRepetables = profile ? instancesActivesParCle(profile.faits.filter((f) => f.cle !== "CONTEXTE_ACTIVITE")) : new Map();
  const profilFaitsActifs = [
    ...(contexteActuel.get("CONTEXTE_ACTIVITE") ? [contexteActuel.get("CONTEXTE_ACTIVITE")!] : []),
    ...[...actifsRepetables.values()].flat(),
  ];

  return NextResponse.json({
    besoin: {
      id: need.id,
      titre: need.titre,
      texteOriginal: need.texteOriginal,
      statut: need.statut,
      coherenceStatut: need.coherenceStatut,
      createdAt: need.createdAt,
      faits: need.faits.map((f) => ({ cle: f.cle, valeur: f.valeur, statut: f.statut })),
    },
    client: need.client,
    profilFaitsActifs: profilFaitsActifs.map((f) => ({ cle: f.cle, valeur: f.valeur, statut: f.statut })),
    eligibilite: evaluerEligibiliteBesoin(need),
    suggestion: suggererCriteresDemande(need.faits),
    demandeTalentCreee: need.demandeTalentCreee,
  });
}
