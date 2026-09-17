import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deciderSolution } from "@/lib/client-solution/decision";

// COMPANY ATLAS — V2.1-E : C3 Solution Intelligence — décision Client.
//
// clientId toujours dérivé de la session (jamais du corps), optionId
// re-vérifié comme appartenant au bon besoin ET au bon client avant toute
// écriture (voir deciderSolution). Append-only strict côté service — cette
// route ne fait jamais d'UPDATE.
export async function POST(_req: NextRequest, { params }: { params: { id: string; optionId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const resultat = await deciderSolution({
    needId: params.id,
    clientId: session.clientId,
    optionId: params.optionId,
    decideParEmail: session.email,
  });

  if (!resultat.ok) {
    if (resultat.code === "BESOIN_INTROUVABLE" || resultat.code === "OPTION_INTROUVABLE") {
      return NextResponse.json({ error: "Besoin ou option introuvable." }, { status: 404 });
    }
    if (resultat.code === "NIVEAU_INVALIDE") {
      return NextResponse.json({ error: "Seule une recommandation peut être décidée, jamais une option directement." }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Cette recommandation n'est plus à jour (le besoin a changé depuis) — rafraîchissez les solutions avant de décider." },
      { status: 409 }
    );
  }

  return NextResponse.json({ decision: resultat.decision });
}
