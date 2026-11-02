import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { demanderActivation, etatAtlasOsClient } from "@/lib/atlas-os/activation";

// LOT 5 (28/10/2026) — état d'ATLAS OS pour le Client connecté, et demande
// d'activation (validée ensuite par un Admin, jamais automatique).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  return NextResponse.json(await etatAtlasOsClient(session.clientId), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const motif = typeof body?.motif === "string" ? body.motif.trim().slice(0, 1000) || null : null;
  const resultat = await demanderActivation(session.clientId, session.email, motif);
  if (!resultat.ok) return NextResponse.json({ error: resultat.erreur }, { status: resultat.code });
  return NextResponse.json(await etatAtlasOsClient(session.clientId), { status: 201 });
}
