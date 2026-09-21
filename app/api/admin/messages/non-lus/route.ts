import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resoudreUserId } from "@/lib/session-user";
import { clientsAvecMessagesNonLusPourAdmin } from "@/lib/message-lecture";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 5 — UX, 21/09/2026).
//
// Vue agrégée pour le badge par ligne de app/admin/clients/page.tsx —
// jamais une requête par Client (N+1) depuis le composant, un seul appel
// qui renvoie l'ensemble des clientId non lus pour CET Admin (règle #7).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const userId = await resoudreUserId(session.email);
  if (!userId) return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });

  const nonLus = await clientsAvecMessagesNonLusPourAdmin(userId);
  return NextResponse.json({ clientIdsNonLus: Array.from(nonLus) });
}
