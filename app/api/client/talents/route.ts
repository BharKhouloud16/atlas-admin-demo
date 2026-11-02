import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { chargerSuiviTalents } from "@/lib/client-talent/suivi";

// LOT 2 (28/10/2026) — Espace Talents du Client : profils proposés pour ses
// besoins validés, anonymes (voir lib/client-talent/suivi.ts).
// REV-02 (01/11/2026) : LECTURE SEULE, nombre de requêtes fixe ; aucune
// recherche n'est lancée ici (voir POST /api/client/talents/actualiser).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const debut = Date.now();
  const besoins = await chargerSuiviTalents(session.clientId);
  return NextResponse.json(
    { besoins },
    { headers: { "Cache-Control": "no-store", "Server-Timing": `total;dur=${Date.now() - debut}` } }
  );
}
