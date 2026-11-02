import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { refuserAccesAdmin } from "@/lib/security/acces-admin";
import { traiterDemandeClient } from "@/lib/demandes-clients/service";

// LOT 2 (28/10/2026) — l'Admin fait avancer une action du Client
// (ENVOYEE -> PRISE_EN_CHARGE -> CLOTUREE). Ne crée jamais de mission :
// la création reste l'action explicite existante (/admin/talent/[id]).
// REV (01/11/2026) : même traitement (et même journalisation) que la vue
// « Demandes clients » — un seul circuit.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return refuserAccesAdmin(req, session, "/api/talent/actions-client/[id]");
  }
  const body = await req.json().catch(() => null);
  const resultat = await traiterDemandeClient({ source: "TALENT", id: params.id, statut: typeof body?.statut === "string" ? body.statut : "", adminEmail: session.email });
  if (!resultat.ok) {
    // 409 conservé pour toute transition refusée (comportement du lot 2).
    return NextResponse.json({ error: resultat.erreur }, { status: resultat.code === 400 ? 409 : resultat.code });
  }
  return NextResponse.json({ ok: true });
}
