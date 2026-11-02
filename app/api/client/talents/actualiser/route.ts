import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { actualiserSuiviTalents, ACTUALISATIONS_MAX_PAR_APPEL } from "@/lib/client-talent/suivi";

// REV-02 (01/11/2026) — relance la recherche de profils pour quelques besoins
// dont la recherche n'est plus à jour (5 au plus par appel). Un besoin déjà à
// jour n'est pas recalculé ; un besoin d'un autre client est ignoré.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const needIds = Array.isArray(body?.needIds) ? body.needIds.filter((x: unknown): x is string => typeof x === "string") : [];
  if (needIds.length === 0 || needIds.length > ACTUALISATIONS_MAX_PAR_APPEL) {
    return NextResponse.json({ error: `needIds : de 1 à ${ACTUALISATIONS_MAX_PAR_APPEL} besoins.` }, { status: 400 });
  }
  const debut = Date.now();
  const besoins = await actualiserSuiviTalents(session.clientId, needIds);
  return NextResponse.json(
    { besoins },
    { headers: { "Cache-Control": "no-store", "Server-Timing": `total;dur=${Date.now() - debut}` } }
  );
}
