import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { obtenirFichier } from "@/lib/storage";

// Sert le fichier CV (stocké en privé sur Vercel Blob) à l'ingénieur
// propriétaire, ou à un ADMIN qui consulte le profil (?profilId=...).
// Le fichier n'est jamais exposé par une URL publique : tout accès passe par
// cette route, qui vérifie les droits avant de streamer le contenu.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const profilIdDemande = req.nextUrl.searchParams.get("profilId");

  let profilId: string | null = null;
  if (session.role === "ADMIN" && profilIdDemande) {
    profilId = profilIdDemande;
  } else if (session.role === "INGENIEUR") {
    profilId = session.profilId;
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
