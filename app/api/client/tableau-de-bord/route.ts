import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { construireTableauDeBord } from "@/lib/client-dashboard/tableau-de-bord";

// LOT 4 (28/10/2026) — tableau de bord Client en UN appel, agrégé côté
// serveur, bloc par bloc (voir lib/client-dashboard/tableau-de-bord.ts).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const debut = Date.now();
  const tableau = await construireTableauDeBord(session.clientId);
  return NextResponse.json(tableau, { headers: { "Cache-Control": "no-store", "Server-Timing": `total;dur=${Date.now() - debut}` } });
}
