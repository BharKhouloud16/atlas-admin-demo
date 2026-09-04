import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Changement de mot de passe par l'utilisateur connecté lui-même (voir
// EspaceIngenieur.tsx -> "Mon compte"). Accessible aux 3 rôles : la session
// ne porte pas d'id utilisateur direct, on retrouve le compte par email
// (unique), comme le fait déjà /api/auth/login pour l'authentification.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { ancienMotDePasse, nouveauMotDePasse, confirmationNouveauMotDePasse } = await req.json();

  if (!ancienMotDePasse || !nouveauMotDePasse || !confirmationNouveauMotDePasse) {
    return NextResponse.json({ error: "Tous les champs sont requis" }, { status: 400 });
  }
  if (nouveauMotDePasse.length < 8) {
    return NextResponse.json({ error: "Le nouveau mot de passe doit contenir au moins 8 caractères" }, { status: 400 });
  }
  if (nouveauMotDePasse !== confirmationNouveauMotDePasse) {
    return NextResponse.json({ error: "Les deux mots de passe ne correspondent pas" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.email } });
  if (!user) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  const ok = await bcrypt.compare(ancienMotDePasse, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Ancien mot de passe incorrect" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(nouveauMotDePasse, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  return NextResponse.json({ ok: true });
}
