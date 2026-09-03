import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { uploaderFichier } from "@/lib/storage";
import { extraireInfosCV } from "@/lib/cv-extraction";

// Upload du CV par l'ingénieur connecté. Crée/écrase les champs InfoCV
// (modèle vide aujourd'hui, pré-rempli par IA demain) prêts à être validés
// un par un sur /ingenieur/cv/verifier.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const form = await req.formData();
  const fichier = form.get("cv");
  if (!fichier || !(fichier instanceof File)) {
    return NextResponse.json({ error: "Fichier CV requis" }, { status: 400 });
  }

  const typesAcceptes = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
  if (fichier.type && !typesAcceptes.includes(fichier.type)) {
    return NextResponse.json({ error: "Format non supporté. Utilisez un PDF ou un Word." }, { status: 400 });
  }

  let url: string;
  try {
    const resultat = await uploaderFichier(fichier.name, fichier, "cv");
    url = resultat.url;
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Échec de l'upload" }, { status: 500 });
  }

  const champs = await extraireInfosCV(url);

  await prisma.$transaction([
    prisma.infoCV.deleteMany({ where: { profilId: session.profilId } }),
    prisma.profil.update({
      where: { id: session.profilId },
      data: {
        cvUrl: url,
        cvNomFichier: fichier.name,
        cvImporteLe: new Date(),
        cvValide: false,
        infosCv: { create: champs },
      },
    }),
  ]);

  return NextResponse.json({ ok: true, url });
}
