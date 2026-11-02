import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifierCode, genererCodesSecours } from "@/lib/totp";

// Étape 2 de l'activation du 2FA : confirme que l'Admin a bien scanné le QR
// code (POST /api/auth/2fa/setup) en saisissant un code à 6 chiffres valide.
// Une fois confirmé, active totpActif et génère des codes de secours à
// usage unique (affichés une seule fois ici, en clair, jamais reconsultables
// ensuite — seuls leurs hashs bcrypt sont conservés en base).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!code) {
    return NextResponse.json({ error: "Code manquant" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.email } });
  if (user?.totpActif) {
    return NextResponse.json({ error: "La double authentification est déjà active." }, { status: 409 });
  }
  if (!user?.totpSecret) {
    return NextResponse.json({ error: "Aucune configuration 2FA en cours — relancez depuis le début." }, { status: 400 });
  }

  if (!verifierCode(code, user.totpSecret)) {
    return NextResponse.json({ error: "Code invalide." }, { status: 400 });
  }

  const codesSecours = genererCodesSecours();
  const codesHashes = await Promise.all(codesSecours.map((c) => bcrypt.hash(c, 10)));

  // Active seulement le secret qui vient d'être vérifié : si un nouveau
  // secret a été généré entre-temps (autre onglet), rien n'est activé.
  const { count } = await prisma.user.updateMany({
    where: { id: user.id, totpActif: false, totpSecret: user.totpSecret },
    data: { totpActif: true, totpCodesSecours: JSON.stringify(codesHashes) },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Configuration 2FA modifiée entre-temps — relancez depuis le début." }, { status: 409 });
  }

  return NextResponse.json({ ok: true, codesSecours });
}
