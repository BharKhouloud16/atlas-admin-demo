import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resoudreUserId } from "@/lib/session-user";
import { lirePreferenceNotification, ecrirePreferenceNotification, validerCategoriesEmail } from "@/lib/preference-notification";
import type { AttentionCategorie } from "@prisma/client";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 3 — Préférences,
// 21/09/2026).
//
// Scopée exclusivement au User.id résolu depuis la session (règle #12,
// même discipline que POST /api/client/messages/lu) — jamais un userId
// accepté depuis le corps de la requête (mass assignment). Pendant Admin :
// app/api/admin/attentions/preferences/route.ts.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const userId = await resoudreUserId(session.email);
  if (!userId) return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });

  return NextResponse.json(await lirePreferenceNotification(userId));
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const userId = await resoudreUserId(session.email);
  if (!userId) return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const donnees: { emailActif?: boolean; categoriesEmail?: AttentionCategorie[] } = {};
  if (typeof body?.emailActif === "boolean") donnees.emailActif = body.emailActif;
  if (body?.categoriesEmail !== undefined) {
    const categories = validerCategoriesEmail(body.categoriesEmail);
    if (!categories) return NextResponse.json({ error: "categoriesEmail invalide." }, { status: 400 });
    donnees.categoriesEmail = categories;
  }

  return NextResponse.json(await ecrirePreferenceNotification(userId, donnees));
}
