import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { uploaderFichier, supprimerFichier } from "@/lib/storage";

const TYPES_ACCEPTES = ["video/mp4", "video/webm", "video/quicktime"];
const TAILLE_MAX_OCTETS = 80 * 1024 * 1024; // 80 Mo — large pour une vidéo de 60-90s en qualité raisonnable

// Upload de la courte vidéo de présentation de l'ingénieur connecté (voir
// Profil.videoUrl dans prisma/schema.prisma) — même mécanisme de stockage
// privé que le CV (voir lib/storage.ts), remplace la vidéo existante s'il y
// en a une (l'ancien fichier est supprimé du store après le remplacement).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const form = await req.formData();
  const fichier = form.get("video");
  if (!fichier || !(fichier instanceof File)) {
    return NextResponse.json({ error: "Fichier vidéo requis" }, { status: 400 });
  }

  if (fichier.type && !TYPES_ACCEPTES.includes(fichier.type)) {
    return NextResponse.json({ error: "Format non supporté. Utilisez MP4, WebM ou MOV." }, { status: 400 });
  }
  if (fichier.size > TAILLE_MAX_OCTETS) {
    return NextResponse.json({ error: "Fichier trop volumineux (80 Mo maximum)." }, { status: 400 });
  }

  const octets = await fichier.arrayBuffer();

  let url: string;
  try {
    const uploade = await uploaderFichier(fichier.name, new Blob([octets], { type: fichier.type }), "videos");
    url = uploade.url;
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Échec de l'upload" }, { status: 500 });
  }

  const ancien = await prisma.profil.findUnique({ where: { id: session.profilId }, select: { videoUrl: true } });

  await prisma.profil.update({
    where: { id: session.profilId },
    data: { videoUrl: url, videoNomFichier: fichier.name, videoImporteLe: new Date() },
  });

  if (ancien?.videoUrl) {
    await supprimerFichier(ancien.videoUrl);
  }

  return NextResponse.json({ ok: true, url });
}

// Retire la vidéo de présentation (sans toucher au reste du profil).
export async function DELETE() {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const profil = await prisma.profil.findUnique({ where: { id: session.profilId }, select: { videoUrl: true } });
  if (profil?.videoUrl) {
    await supprimerFichier(profil.videoUrl);
  }

  await prisma.profil.update({
    where: { id: session.profilId },
    data: { videoUrl: null, videoNomFichier: null, videoImporteLe: null },
  });

  return NextResponse.json({ ok: true });
}
