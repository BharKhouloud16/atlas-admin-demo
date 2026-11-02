import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { refuserAccesAdmin } from "@/lib/security/acces-admin";
import { deciderActivation } from "@/lib/atlas-os/activation";

// LOT 5 (28/10/2026) — décision ADMIN : activer, refuser ou désactiver
// ATLAS OS pour un client (transitions contrôlées, journalisées).
const STATUTS = new Set(["ACTIVEE", "REFUSEE", "DESACTIVEE"]);

export async function PATCH(req: NextRequest, { params }: { params: { clientId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return refuserAccesAdmin(req, session, "/api/atlas-os/activations/[clientId]");
  }
  const body = await req.json().catch(() => null);
  const statut = typeof body?.statut === "string" ? body.statut : "";
  if (!STATUTS.has(statut)) return NextResponse.json({ error: "statut : ACTIVEE, REFUSEE ou DESACTIVEE." }, { status: 400 });
  const motif = typeof body?.motif === "string" ? body.motif.trim().slice(0, 1000) || null : null;
  const resultat = await deciderActivation({ clientId: params.clientId, adminEmail: session.email, statut: statut as "ACTIVEE" | "REFUSEE" | "DESACTIVEE", motif });
  if (!resultat.ok) return NextResponse.json({ error: resultat.erreur }, { status: resultat.code });
  return NextResponse.json({ ok: true });
}
