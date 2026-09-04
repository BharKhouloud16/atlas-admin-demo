import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { motDePasseSchema, premierMessageZod } from "@/lib/validation";
import { validerMotDePasse } from "@/lib/password-policy";

// Changement de mot de passe par l'utilisateur connecté lui-même (voir
// EspaceIngenieur.tsx -> "Mon compte"). Accessible aux 3 rôles : la session
// ne porte pas d'id utilisateur direct, on retrouve le compte par email
// (unique), comme le fait déjà /api/auth/login pour l'authentification.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const corps = await req.json();
  const analyse = motDePasseSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const { ancienMotDePasse, nouveauMotDePasse } = analyse.data;

  const politique = await validerMotDePasse(nouveauMotDePasse);
  if (!politique.ok) {
    return NextResponse.json({ error: politique.erreur }, { status: 400 });
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
