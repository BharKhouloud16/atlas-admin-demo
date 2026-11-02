import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { enregistrerActionTalent } from "@/lib/client-talent/suivi";

// LOT 2 (28/10/2026) — action du Client sur un profil proposé : poursuivre,
// ne pas retenir, ou demander d'autres profils pour un besoin. N'affecte
// jamais un profil à une mission et ne révèle aucune identité : l'action est
// transmise à l'équipe ATLAS (vue Admin du besoin), qui seule décide de la
// suite avec les outils existants.
const TYPES = new Set(["POURSUIVRE", "NE_PAS_RETENIR", "AUTRES_PROFILS"]);

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const needId = typeof body?.needId === "string" ? body.needId : "";
  const type = typeof body?.type === "string" ? body.type : "";
  if (!needId || !TYPES.has(type)) {
    return NextResponse.json({ error: "needId et type (POURSUIVRE, NE_PAS_RETENIR ou AUTRES_PROFILS) sont requis." }, { status: 400 });
  }
  const commentaireBrut = typeof body?.commentaire === "string" ? body.commentaire.trim() : "";
  if (commentaireBrut.length > 1000) {
    return NextResponse.json({ error: "Commentaire limité à 1000 caractères." }, { status: 400 });
  }
  const resultat = await enregistrerActionTalent({
    clientId: session.clientId,
    email: session.email,
    needId,
    type: type as "POURSUIVRE" | "NE_PAS_RETENIR" | "AUTRES_PROFILS",
    cible: {
      solutionOptionId: typeof body?.solutionOptionId === "string" ? body.solutionOptionId : undefined,
      shortlistEntreeId: typeof body?.shortlistEntreeId === "string" ? body.shortlistEntreeId : undefined,
    },
    commentaire: commentaireBrut || null,
  });
  if (!resultat.ok) return NextResponse.json({ error: resultat.erreur, manquants: resultat.manquants }, { status: resultat.code });
  return NextResponse.json({ id: resultat.id }, { status: 201 });
}
