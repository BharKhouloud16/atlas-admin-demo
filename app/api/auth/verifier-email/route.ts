import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lireCorpsJson } from "@/lib/api-errors";

// Confirme l'adresse email d'un compte fraîchement inscrit (voir
// app/api/auth/signup/route.ts et app/verifier-email/page.tsx). Tant que ce
// n'est pas fait, la connexion est bloquée (voir app/api/auth/login/route.ts).
export async function POST(req: NextRequest) {
  const corps = await lireCorpsJson(req);
  const token = corps && typeof corps === "object" ? (corps as { token?: unknown }).token : undefined;
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

  // Usage unique garanti en base : n'aboutit que si ce jeton est toujours
  // celui du compte (requêtes simultanées avec le même lien : une seule réussit).
  const { count } = await prisma.user.updateMany({
    where: { id: user.id, emailVerificationToken: token },
    data: { emailVerifie: true, emailVerificationToken: null, emailVerificationExpire: null },
  });
  if (count !== 1) {
    return NextResponse.json(
      { error: "Ce lien de vérification est invalide ou a déjà été utilisé." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
