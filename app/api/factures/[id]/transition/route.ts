import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { journaliser } from "@/lib/audit";
import { validerFacture, envoyerFacture, annulerFacture } from "@/lib/billing/transitions";

// COMPANY ATLAS — V2.2-B : Billing Foundation — transitions de statut.
//
// Admin uniquement — jamais le Client (il ne fait que consulter/télécharger,
// voir app/api/factures/[id]/route.ts et .../document/route.ts). Toute
// transition passe par lib/billing/transitions.ts (elle-même contrainte par
// lib/billing/etat-facture.ts, transitionAutorisee()) — jamais une écriture
// directe du statut depuis cette route.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/factures/[id]/transition",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Facture",
      detail: "Tentative de transition de facture par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  const resultat =
    action === "valider" ? await validerFacture(id) : action === "envoyer" ? await envoyerFacture(id) : action === "annuler" ? await annulerFacture(id, String(body.motif ?? "")) : null;

  if (!resultat) return NextResponse.json({ error: "Action invalide." }, { status: 400 });

  if (!resultat.ok) {
    if (resultat.code === "FACTURE_INTROUVABLE") return NextResponse.json({ error: "Facture introuvable." }, { status: 404 });
    return NextResponse.json({ error: "Transition de statut invalide depuis l'état actuel de cette facture." }, { status: 409 });
  }

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: `facture_${action}`,
    cible: id,
    detail: `Facture ${resultat.facture.numeroFacture} : transition "${action}" -> ${resultat.facture.statut}.`,
  });

  return NextResponse.json({ facture: resultat.facture });
}
