import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { resoudreUserId } from "@/lib/session-user";

// COMPANY ATLAS — V2.3 : Communication Intelligence + Attention Center —
// lecture individuelle Admin.
//
// Même discipline read/unread que le pendant Client (voir
// app/api/client/attentions/[id]/route.ts) : "lire" toujours permis,
// "resoudre" réservé à INFORMATION/RECOMMANDATION (une ANOMALIE_FINANCIERE,
// catégorie ALERTE, ne peut jamais être classée résolue manuellement — seule
// la correction réelle de la Facture par les routes Billing existantes la
// fait disparaître, via lib/attention/synchronisation.ts à la prochaine
// lecture).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const { id } = await params;
  const attention = await prisma.attention.findUnique({ where: { id } });
  if (!attention || attention.recipientType !== "ADMIN") {
    return NextResponse.json({ error: "Attention introuvable." }, { status: 404 });
  }

  // V2.5 — Communication Intelligence (Lot 2, 21/09/2026) : une Attention
  // ADMIN à recipientId non-null est individuelle (règle #7 — voir
  // GET /api/admin/attentions) — jamais actionnable par un autre Admin que
  // celui qu'elle vise. recipientId=null (ex. ANOMALIE_FINANCIERE) reste
  // partagé comme avant V2.5, aucun changement de comportement pour ce cas.
  if (attention.recipientId) {
    const userId = await resoudreUserId(session.email);
    if (attention.recipientId !== userId) {
      return NextResponse.json({ error: "Attention introuvable." }, { status: 404 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  if (action !== "lire" && action !== "resoudre") {
    return NextResponse.json({ error: "Action invalide (attendu : lire | resoudre)." }, { status: 400 });
  }

  if (action === "resoudre" && attention.categorie !== "INFORMATION" && attention.categorie !== "RECOMMANDATION") {
    return NextResponse.json({ error: "Cette attention ne peut pas être marquée comme résolue manuellement." }, { status: 409 });
  }

  const maintenant = new Date();
  const misAJour = await prisma.attention.update({
    where: { id },
    data:
      action === "lire"
        ? { statut: attention.statut === "OUVERTE" ? "LUE" : attention.statut, readAt: attention.readAt ?? maintenant }
        : { statut: "RESOLUE", resolvedAt: maintenant, readAt: attention.readAt ?? maintenant },
  });

  return NextResponse.json({ attention: { id: misAJour.id, statut: misAJour.statut } });
}
