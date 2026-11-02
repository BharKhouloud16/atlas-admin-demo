import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { refuserAccesAdmin } from "@/lib/security/acces-admin";
import { traiterDemandeClient } from "@/lib/demandes-clients/service";

// REV (01/11/2026) — l'Admin prend en charge ou clôture une demande Client
// (Talents ou Projets). Transitions conditionnées au statut lu, journalisées.
export async function PATCH(req: NextRequest, { params }: { params: { source: string; id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return refuserAccesAdmin(req, session, "/api/admin/demandes-clients/[source]/[id]");
  }
  const body = await req.json().catch(() => null);
  const resultat = await traiterDemandeClient({
    source: params.source,
    id: params.id,
    statut: typeof body?.statut === "string" ? body.statut : "",
    adminEmail: session.email,
  });
  if (!resultat.ok) return NextResponse.json({ error: resultat.erreur }, { status: resultat.code });
  return NextResponse.json({ ok: true });
}
