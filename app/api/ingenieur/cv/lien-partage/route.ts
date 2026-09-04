import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { creerUrlSignee } from "@/lib/url-signee";

// Génère un lien de partage temporaire (24h) vers le CV d'un ingénieur,
// utilisable sans compte — voir GET /api/ingenieur/cv/fichier?partage=...
// et lib/url-signee.ts. Réservé à l'Admin (ex. envoyer le CV par email à un
// prospect qui n'a pas encore de compte sur la plateforme).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { profilId } = (await req.json().catch(() => ({}))) as { profilId?: string };
  if (!profilId) {
    return NextResponse.json({ error: "profilId manquant" }, { status: 400 });
  }

  const profil = await prisma.profil.findUnique({ where: { id: profilId }, select: { cvUrl: true } });
  if (!profil?.cvUrl) {
    return NextResponse.json({ error: "Aucun CV importé pour ce profil" }, { status: 404 });
  }

  const { token, expire } = creerUrlSignee(`cv:${profilId}`);
  const url = `${req.nextUrl.origin}/api/ingenieur/cv/fichier?profilId=${profilId}&partage=${token}`;
  return NextResponse.json({ url, expire });
}
