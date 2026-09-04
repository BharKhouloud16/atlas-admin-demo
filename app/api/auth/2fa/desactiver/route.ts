import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Désactive le 2FA — demande le mot de passe actuel par sécurité (une
// session dérobée ne suffit pas à elle seule à désactiver la protection).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { motDePasse } = (await req.json().catch(() => ({}))) as { motDePasse?: string };
  const user = await prisma.user.findUnique({ where: { email: session.email } });
  if (!user || !motDePasse || !(await bcrypt.compare(motDePasse, user.passwordHash))) {
    return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 403 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { totpActif: false, totpSecret: null, totpCodesSecours: null },
  });

  return NextResponse.json({ ok: true });
}
