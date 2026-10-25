import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { creerFactureDepuisFeuille } from "@/lib/billing/creation";

// Facture d'un CRA définitivement validé (statut ValideeClient — voir PATCH
// /api/feuilles-de-temps, action=validerClient). Réservé à l'Admin.
//
// Lot CRA V1 (25/10/2026) : cette route ne génère plus son propre PDF.
// Elle générait un document calculé depuis le CRA, hors du circuit de
// facturation : sans numéro réglementaire ni TVA enregistrée, et
// potentiellement différent du PDF de la Facture. Désormais :
//   - la Facture est créée si elle n'existe pas encore (idempotent, voir
//     lib/billing/creation.ts) ;
//   - si elle est émise (validée), redirection vers son PDF
//     (/api/factures/[id]/document), seul document de facture ;
//   - si elle est encore en brouillon, 409 : elle doit d'abord être validée
//     depuis /admin/factures, ce qui lui attribue son numéro réglementaire.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const feuilleId = req.nextUrl.searchParams.get("feuilleId");
  if (!feuilleId) {
    return NextResponse.json({ error: "feuilleId requis" }, { status: 400 });
  }

  const feuille = await prisma.feuilleDeTemps.findUnique({ where: { id: feuilleId }, select: { id: true, statut: true } });
  if (!feuille) {
    return NextResponse.json({ error: "Feuille de temps introuvable" }, { status: 404 });
  }
  if (feuille.statut !== "ValideeClient") {
    return NextResponse.json(
      { error: "Cette feuille de temps n'est pas encore validée par le Client — facture non disponible." },
      { status: 409 }
    );
  }

  const resultat = await creerFactureDepuisFeuille(feuille.id);
  if (!resultat.ok) {
    return NextResponse.json({ error: "Facture indisponible pour cette feuille de temps." }, { status: 409 });
  }
  const facture = resultat.facture;
  if (!facture.dateEmission) {
    return NextResponse.json(
      {
        error: "La facture de cette feuille de temps est en brouillon : validez-la depuis Factures pour lui attribuer son numéro et émettre son PDF.",
        factureId: facture.id,
      },
      { status: 409 }
    );
  }
  return NextResponse.redirect(new URL(`/api/factures/${facture.id}/document`, req.nextUrl.origin), 307);
}
