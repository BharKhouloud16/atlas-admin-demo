import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email et mot de passe requis" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // même message que mot de passe invalide : ne pas révéler si l'email existe
    return NextResponse.json({ error: "Identifiants invalides" }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Identifiants invalides" }, { status: 401 });
  }

  if (!user.actif) {
    return NextResponse.json(
      { error: "Votre compte est en attente de validation par l'administrateur." },
      { status: 403 }
    );
  }

  await createSession({
    email: user.email,
    role: user.role,
    profilId: user.profilId,
    clientId: user.clientId,
  });

  // indique au front vers quel espace rediriger
  const redirect = user.role === "CLIENT" ? "/client" : "/admin";
  return NextResponse.json({ ok: true, role: user.role, redirect });
}
