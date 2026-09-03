import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { uploaderFichier } from "@/lib/storage";
import { extraireInfosCV, modeleChampsVides } from "@/lib/cv-extraction";

// Upload du CV par l'ingénieur connecté. Le contenu du fichier est envoyé à
// l'IA (Claude) pour pré-remplir les champs InfoCV avec les informations
// réelles du CV ; l'ingénieur n'a plus qu'à les valider (ou corriger) un par
// un sur /ingenieur/cv/verifier. Si l'extraction IA échoue ou n'est pas
// configurée, les champs sont créés vides et restent à saisir manuellement
// (l'import du CV n'est jamais bloqué par ça).
//
// Seul le PDF est accepté pour le moment : l'extraction IA s'appuie sur le
// support natif des documents PDF de l'API Claude.
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

  const typesAcceptes = ["application/pdf"];
  if (fichier.type && !typesAcceptes.includes(fichier.type)) {
    return NextResponse.json({ error: "Format non supporté. Utilisez un PDF." }, { status: 400 });
  }

  const octets = await fichier.arrayBuffer();

  let url: string;
  try {
    const resultat = await uploaderFichier(fichier.name, new Blob([octets], { type: fichier.type }), "cv");
    url = resultat.url;
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Échec de l'upload" }, { status: 500 });
  }

  const base64 = Buffer.from(octets).toString("base64");
  let champs;
  try {
    champs = await extraireInfosCV(base64);
  } catch (e: any) {
    // Clé API absente ou mal configurée : on ne bloque pas l'import, les
    // champs seront simplement vides à saisir manuellement.
    console.error("Extraction IA du CV impossible :", e.message ?? e);
    champs = modeleChampsVides();
  }

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
