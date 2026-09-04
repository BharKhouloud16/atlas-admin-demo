import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { genererFacturePdf } from "@/lib/pdf-facture";

// Génère la facture PDF (voir lib/pdf-facture.ts) d'un CRA définitivement
// validé (statut ValideeClient — voir PATCH /api/feuilles-de-temps,
// action=validerClient). Réservé à l'Admin : c'est lui qui transmet la
// facture au client une fois le circuit de double validation terminé.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const feuilleId = req.nextUrl.searchParams.get("feuilleId");
  if (!feuilleId) {
    return NextResponse.json({ error: "feuilleId requis" }, { status: 400 });
  }

  const feuille = await prisma.feuilleDeTemps.findUnique({
    where: { id: feuilleId },
    include: { mission: { include: { client: true, profil: true } } },
  });

  if (!feuille) {
    return NextResponse.json({ error: "Feuille de temps introuvable" }, { status: 404 });
  }
  if (feuille.statut !== "ValideeClient") {
    return NextResponse.json(
      { error: "Cette feuille de temps n'est pas encore validée par le Client — facture non disponible." },
      { status: 409 }
    );
  }

  const numero = `FA-${feuille.mois.replace("-", "")}-${feuille.mission.id.slice(0, 6).toUpperCase()}`;
  const nomIngenieur = `${feuille.mission.profil.prenom ?? ""} ${feuille.mission.profil.nom}`.trim();

  const pdfBytes = await genererFacturePdf({
    numero,
    dateEmission: feuille.valideeClientLe ?? new Date(),
    mois: feuille.mois,
    clientNom: feuille.mission.client.nom,
    clientAdresse: feuille.mission.client.pays,
    missionRepere: feuille.mission.repere,
    ingenieurNom: nomIngenieur,
    joursTravailles: feuille.joursTravailles,
    heuresSupplementaires: feuille.heuresSupplementaires,
    tjmVente: feuille.mission.tjmVente,
  });

  return new NextResponse(pdfBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
      "Content-Disposition": `inline; filename="${numero}.pdf"`,
    },
  });
}
