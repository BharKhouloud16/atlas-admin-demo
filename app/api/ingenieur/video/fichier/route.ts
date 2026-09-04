import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { obtenirFichier } from "@/lib/storage";

// Sert la vidéo de présentation (stockée en privé sur Vercel Blob) :
// - à l'ingénieur propriétaire (aucun ?profilId requis) ;
// - à un ADMIN qui consulte un profil (?profilId=...) ;
// - à un CLIENT ayant une mission (passée ou en cours) avec ce profil
//   (?profilId=...) — un client ne peut voir la vidéo que des ingénieurs
//   avec qui il a réellement travaillé, jamais l'ensemble du vivier.
// Jamais d'URL publique : tout accès passe par cette route, qui vérifie les
// droits avant de streamer le contenu.
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
  } else if (session.role === "CLIENT" && profilIdDemande && session.clientId) {
    const mission = await prisma.mission.findFirst({
      where: { profilId: profilIdDemande, clientId: session.clientId },
      select: { id: true },
    });
    if (mission) {
      profilId = profilIdDemande;
    }
  }

  if (!profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const profil = await prisma.profil.findUnique({
    where: { id: profilId },
    select: { videoUrl: true, videoNomFichier: true },
  });

  if (!profil?.videoUrl) {
    return NextResponse.json({ error: "Aucune vidéo importée" }, { status: 404 });
  }

  const fichier = await obtenirFichier(profil.videoUrl);
  if (!fichier) {
    return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  }

  return new NextResponse(fichier.stream, {
    headers: {
      "Content-Type": fichier.contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
      "Content-Disposition": `inline; filename="${profil.videoNomFichier ?? "video"}"`,
    },
  });
}
