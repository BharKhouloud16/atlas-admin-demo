import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { envoyerEmailCompteValide } from "@/lib/email";

// Réservé à l'Admin — le middleware protège déjà /api/comptes, mais on
// revérifie le rôle ici (defense in depth, comme pour les autres routes).
async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return null;
  return session;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const enAttente = await prisma.user.findMany({
    where: { actif: false },
    include: { profil: true, client: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(enAttente);
}

// Valide un compte, et pour un INGENIEUR, fixe son type de contrat et son
// tarif au passage (négociés hors ligne avant validation).
export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const { userId, typeContrat, montant } = await req.json();
  if (!userId) {
    return NextResponse.json({ error: "userId requis" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { actif: true },
    include: { profil: true, client: true },
  });

  if (user.role === "INGENIEUR" && user.profilId && typeContrat && montant != null) {
    await prisma.profil.update({
      where: { id: user.profilId },
      data: { type: typeContrat, montantSaisi: montant },
    });
  }

  const nom = user.role === "INGENIEUR" ? user.profil?.nom : user.client?.nom;
  if (nom) {
    await envoyerEmailCompteValide({ to: user.email, nom, role: user.role === "INGENIEUR" ? "INGENIEUR" : "CLIENT" });
  }

  return NextResponse.json({ ok: true });
}
