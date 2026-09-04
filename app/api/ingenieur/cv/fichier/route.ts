import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { obtenirFichier } from "@/lib/storage";
import { verifierUrlSignee } from "@/lib/url-signee";

// Sert le fichier CV (stocké en privé sur Vercel Blob) à l'ingénieur
// propriétaire, à un ADMIN qui consulte le profil (?profilId=...), ou à
// quiconque possède un lien de partage signé et non expiré (?partage=...,
// voir POST /api/ingenieur/cv/lien-partage et lib/url-signee.ts). Le fichier
// n'est jamais exposé par une URL publique brute : tout accès passe ici.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const profilIdDemande = req.nextUrl.searchParams.get("profilId");
  const partage = req.nextUrl.searchParams.get("partage");

  let profilId: string | null = null;
  if (session?.role === "ADMIN" && profilIdDemande) {
    profilId = profilIdDemande;
  } else if (session?.role === "INGENIEUR") {
    profilId = session.profilId;
  } else if (!session && profilIdDemande && verifierUrlSignee(`cv:${profilIdDemande}`, partage)) {
    profilId = profilIdDemande;
  }

  if (!profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const profil = await prisma.profil.findUnique({
    where: { id: profilId },
    select: { cvUrl: true, cvNomFichier: true },
  });

  if (!profil?.cvUrl) {
    return NextResponse.json({ error: "Aucun CV importé" }, { status: 404 });
  }

  const fichier = await obtenirFichier(profil.cvUrl);
  if (!fichier) {
    return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  }

  return new NextResponse(fichier.stream, {
    headers: {
      "Content-Type": fichier.contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
      "Content-Disposition": `inline; filename="${profil.cvNomFichier ?? "cv"}"`,
    },
  });
}
