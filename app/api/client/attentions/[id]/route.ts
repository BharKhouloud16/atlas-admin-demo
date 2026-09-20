import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// COMPANY ATLAS — V2.3 : Communication Intelligence + Attention Center —
// lecture individuelle Client.
//
// Ownership vérifié par (id, recipientType=CLIENT, recipientId=clientId) —
// 404 (jamais 403) en cas de mismatch, même discipline IDOR que
// app/api/factures/[id]/document/route.ts : un Client ne doit jamais pouvoir
// distinguer "n'existe pas" de "appartient à un autre Client" (mandat CEO
// V2.3 section 6 : "Un Client ne doit jamais pouvoir lire ou modifier
// l'état de lecture d'un autre Client").
//
// Deux actions seulement : "lire" (statut -> LUE, toujours permis) et
// "resoudre" (statut -> RESOLUE, UNIQUEMENT pour INFORMATION/RECOMMANDATION
// — jamais pour ACTION_REQUISE/ALERTE, dont la résolution est TOUJOURS
// dérivée du fait métier réel par lib/attention/synchronisation.ts, jamais
// une décision du Client qui ferait disparaître une facture réellement
// impayée ou un besoin réellement à clarifier).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const { id } = await params;
  const attention = await prisma.attention.findUnique({ where: { id } });
  if (!attention || attention.recipientType !== "CLIENT" || attention.recipientId !== session.clientId) {
    return NextResponse.json({ error: "Attention introuvable." }, { status: 404 });
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
