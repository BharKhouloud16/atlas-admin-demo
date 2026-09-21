import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resoudreUserId } from "@/lib/session-user";
import { lirePreferenceNotification, ecrirePreferenceNotification, validerCategoriesEmail } from "@/lib/preference-notification";
import type { AttentionCategorie } from "@prisma/client";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 3 — Préférences,
// 21/09/2026).
//
// Pendant ADMIN de app/api/client/attentions/preferences/route.ts —
// réservé ADMIN. Scopée exclusivement au User.id de CET Admin (règle #12
// et #7 — chaque Admin règle ses propres préférences, jamais un réglage
// partagé par rôle).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const userId = await resoudreUserId(session.email);
  if (!userId) return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });

  return NextResponse.json(await lirePreferenceNotification(userId));
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
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
