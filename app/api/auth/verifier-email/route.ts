import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Confirme l'adresse email d'un compte fraîchement inscrit (voir
// app/api/auth/signup/route.ts et app/verifier-email/page.tsx). Tant que ce
// n'est pas fait, la connexion est bloquée (voir app/api/auth/login/route.ts).
export async function POST(req: NextRequest) {
  const { token } = await req.json();
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Lien de vérification invalide." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { emailVerificationToken: token } });
  if (!user) {
    return NextResponse.json(
      { error: "Ce lien de vérification est invalide ou a déjà été utilisé." },
      { status: 400 }
    );
  }

  if (user.emailVerificationExpire && user.emailVerificationExpire < new Date()) {
    return NextResponse.json(
      { error: "Ce lien de vérification a expiré. Demandez-en un nouveau." },
      { status: 400 }
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifie: true, emailVerificationToken: null, emailVerificationExpire: null },
  });

  return NextResponse.json({ ok: true });
}
