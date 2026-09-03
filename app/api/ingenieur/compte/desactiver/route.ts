import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, destroySession } from "@/lib/auth";

// Désactivation temporaire du compte par l'ingénieur lui-même (réversible,
// voir .../reactiver). Déconnecte immédiatement : à la prochaine connexion,
// une nouvelle session est émise avec desactive=true et le middleware
// redirige vers /ingenieur/compte-desactive (voir middleware.ts).
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  await prisma.user.update({
    where: { profilId: session.profilId },
    data: { desactive: true, desactiveLe: new Date() },
  });

  await destroySession();

  return NextResponse.json({ ok: true });
}
