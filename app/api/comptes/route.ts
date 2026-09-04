import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { envoyerEmailCompteValide } from "@/lib/email";
import { journaliser } from "@/lib/audit";

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

// Valide un compte. Pour un INGENIEUR, le type de contrat et le TJM ne sont
// plus fixés ici : ils seront déterminés après import et validation de son
// CV (voir /ingenieur/cv et /ingenieur/cv/verifier), sur la base de
// l'analyse de son profil.
export async function PATCH(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const { userId } = await req.json();
  if (!userId) {
    return NextResponse.json({ error: "userId requis" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { actif: true, valideLe: new Date() },
    include: { profil: true, client: true },
  });

  const nom = user.role === "INGENIEUR" ? user.profil?.nom : user.client?.nom;
  if (nom) {
    await envoyerEmailCompteValide({ to: user.email, nom, role: user.role === "INGENIEUR" ? "INGENIEUR" : "CLIENT" });
  }

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "validation_compte",
    cible: user.id,
    detail: `Compte ${user.role} (${user.email}) validé.`,
  });

  return NextResponse.json({ ok: true });
}
