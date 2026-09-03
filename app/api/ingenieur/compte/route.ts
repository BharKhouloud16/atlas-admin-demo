import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, destroySession } from "@/lib/auth";

// Suppression définitive du profil ingénieur, à sa demande (voir
// /ingenieur -> "Mon compte"). Bloquée dès qu'un historique de mission
// existe (en cours ou passée) : la suppression casserait les données de
// facturation/reporting côté Admin, mieux vaut alors passer par l'Admin.
export async function DELETE() {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const profil = await prisma.profil.findUnique({
    where: { id: session.profilId },
    select: { id: true, missions: { select: { id: true, statut: true } } },
  });

  if (!profil) {
    return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });
  }

  if (profil.missions.length > 0) {
    const enCours = profil.missions.some((m) => m.statut === "En cours");
    return NextResponse.json(
      {
        error: enCours
          ? "Vous avez une mission en cours avec Atlas : contactez l'administrateur (contact@atlas-qa.com) pour la clôturer avant de pouvoir supprimer votre profil."
          : "Votre profil a un historique de missions avec Atlas : contactez l'administrateur (contact@atlas-qa.com) pour une suppression définitive. Vous pouvez en attendant désactiver temporairement votre compte.",
      },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    prisma.user.delete({ where: { profilId: session.profilId } }),
    prisma.profil.delete({ where: { id: session.profilId } }), // supprime aussi les InfoCV en cascade
  ]);

  await destroySession();

  return NextResponse.json({ ok: true });
}
