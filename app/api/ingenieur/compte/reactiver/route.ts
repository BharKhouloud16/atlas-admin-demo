import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, createSession } from "@/lib/auth";

// Réactivation du compte par l'ingénieur lui-même, depuis l'écran
// /ingenieur/compte-desactive. Réémet immédiatement une session à jour
// (desactive=false) pour ne pas exiger une reconnexion.
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  await prisma.user.update({
    where: { profilId: session.profilId },
    data: { desactive: false, desactiveLe: null },
  });

  await createSession({
    email: session.email,
    role: session.role,
    profilId: session.profilId,
    clientId: session.clientId,
    desactive: false,
  });

  return NextResponse.json({ ok: true });
}
