import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { resoudreUserId } from "@/lib/session-user";
import { marquerFilLu } from "@/lib/message-lecture";
import { synchroniserAttentionsClient } from "@/lib/attention/synchronisation";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 1 — Read State,
// 21/09/2026).
//
// Pendant ADMIN de POST /api/client/messages/lu — réservé ADMIN (même
// discipline de défense en profondeur que /api/clients/[id]/messages).
// userId = User.id réel de CET Admin (règle #7 : "Admin = lecture propre au
// User Admin") — jamais un curseur partagé par rôle, chaque Admin marque
// son propre fil comme lu indépendamment des autres.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: `/api/clients/${id}/messages/lu`,
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Message",
      detail: "Tentative de marquage de lecture de la messagerie d'un client par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const client = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!client) {
    return NextResponse.json({ error: "Client introuvable." }, { status: 404 });
  }

  const userId = await resoudreUserId(session.email);
  if (!userId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const curseur = await marquerFilLu(id, userId);
  await synchroniserAttentionsClient(id);

  return NextResponse.json({ dernierLuLe: curseur.dernierLuLe.toISOString() });
}
