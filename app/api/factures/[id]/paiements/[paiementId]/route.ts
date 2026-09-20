import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { journaliser } from "@/lib/audit";
import { annulerPaiement } from "@/lib/billing/paiement";

// COMPANY ATLAS — V2.2-D : Billing — correction (annulation) d'un Paiement.
//
// Admin uniquement — jamais le Client, jamais l'Ingénieur (même défense en
// profondeur que app/api/factures/[id]/paiements/route.ts). Un seul
// correctif possible ("annuler", voir mandat CEO V2.2-D section 16 :
// "corriger selon règles autorisées") — pas de champ `action` générique,
// jamais une édition libre du montant/de la référence (le paiement d'origine
// reste lisible tel quel, seul son statut change : voir
// lib/billing/paiement.ts annulerPaiement() et Facture.motifAnnulation pour
// le principe équivalent déjà appliqué à Facture).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; paiementId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/factures/[id]/paiements/[paiementId]",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Paiement",
      detail: "Tentative d'annulation d'un paiement par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const { id, paiementId } = await params;

  // Cohérence de l'URL — le paiement doit réellement appartenir à la
  // Facture désignée (jamais une confusion d'id entre deux Factures, même
  // si seul l'Admin peut atteindre cette route).
  const paiementExistant = await prisma.paiement.findUnique({ where: { id: paiementId }, select: { factureId: true } });
  if (!paiementExistant || paiementExistant.factureId !== id) {
    return NextResponse.json({ error: "Paiement introuvable." }, { status: 404 });
  }

  const resultat = await annulerPaiement(paiementId);
  if (!resultat.ok) {
    return NextResponse.json({ error: "Paiement introuvable." }, { status: 404 });
  }

  if (!resultat.dejaAnnule) {
    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "annulation_paiement",
      cible: resultat.paiement.id,
      detail: `Paiement ${resultat.paiement.id} (réf. ${resultat.paiement.reference}) annulé sur la facture ${id}.`,
    });
  }

  return NextResponse.json({ paiement: { id: resultat.paiement.id, statut: resultat.paiement.statut } });
}
