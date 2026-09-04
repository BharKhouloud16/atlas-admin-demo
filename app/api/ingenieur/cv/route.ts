import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { uploaderFichier } from "@/lib/storage";
import { extraireInfosCV, modeleChampsVides, type ResultatExtractionCV } from "@/lib/cv-extraction";

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

  // Extraction + vérification du secteur AVANT l'upload : un CV hors-sujet
  // (pas informatique/QA) est rejeté sans être stocké ni rattaché au profil.
  const base64 = Buffer.from(octets).toString("base64");
  let resultat: ResultatExtractionCV;
  try {
    resultat = await extraireInfosCV(base64);
  } catch (e: any) {
    // Clé API absente ou mal configurée : on ne bloque pas l'import, les
    // champs seront simplement vides à saisir manuellement (et on ne peut
    // alors pas vérifier le secteur — l'import n'est pas bloqué pour autant).
    console.error("Extraction IA du CV impossible :", e.message ?? e);
    resultat = { horsSecteur: false, secteurDetecte: "", champs: modeleChampsVides() };
  }

  if (resultat.horsSecteur) {
    // Message bloquant mais professionnel et poli : on explique le
    // positionnement du site plutôt que de simplement rejeter le fichier.
    return NextResponse.json(
      {
        error:
          "Merci pour votre CV, mais celui-ci ne semble pas correspondre à un profil informatique" +
          (resultat.secteurDetecte ? ` (domaine identifié : ${resultat.secteurDetecte})` : "") +
          ". Atlas Quality Partners est une plateforme dédiée exclusivement au recrutement de professionnels de l'informatique (développement, QA/test logiciel, cybersécurité, data, DevOps, IT en général) et ne peut malheureusement pas traiter les candidatures pour d'autres métiers. Si vous pensez qu'il s'agit d'une erreur, n'hésitez pas à nous contacter à contact@atlas-qa.com.",
      },
      { status: 422 }
    );
  }

  const champs = resultat.champs;

  let url: string;
  try {
    const uploade = await uploaderFichier(fichier.name, new Blob([octets], { type: fichier.type }), "cv");
    url = uploade.url;
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Échec de l'upload" }, { status: 500 });
  }

  // Historique des versions (voir prisma/schema.prisma, VersionCv) : avant
  // d'écraser le CV actuel, on archive celui qui est encore en place (s'il
  // y en a un — un premier import n'a rien à archiver). Le fichier Blob
  // n'est jamais supprimé, seule la référence en base change.
  const profilAvant = await prisma.profil.findUnique({
    where: { id: session.profilId },
    select: { cvUrl: true, cvNomFichier: true, cvImporteLe: true },
  });

  await prisma.$transaction([
    ...(profilAvant?.cvUrl
      ? [
          prisma.versionCv.create({
            data: {
              profilId: session.profilId,
              cvUrl: profilAvant.cvUrl,
              cvNomFichier: profilAvant.cvNomFichier,
              importeLe: profilAvant.cvImporteLe ?? new Date(),
            },
          }),
        ]
      : []),
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
