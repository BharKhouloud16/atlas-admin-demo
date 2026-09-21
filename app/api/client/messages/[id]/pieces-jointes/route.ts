import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { uploaderFichier } from "@/lib/storage";
import { validerPieceJointe, calculerHashPieceJointe } from "@/lib/piece-jointe";

// COMPANY ATLAS — V2.4 : Pièces jointes sécurisées (Lot 1) — upload Client.
//
// [id] = Message.id (jamais un clientId dans l'URL : dérivé exclusivement
// de session.clientId, même discipline que POST /api/client/messages).
// Ownership vérifiée par relecture du Message (message.clientId ===
// session.clientId) — 404 si absent ou d'un autre client, jamais une
// fuite d'existence (même convention que
// app/api/client/documents/[id]/fichier/route.ts). Ingénieur exclu par
// construction (role !== "CLIENT" tombe dans le refus ci-dessous).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const { id } = await params;
  const message = await prisma.message.findUnique({ where: { id }, select: { id: true, clientId: true } });
  if (!message || message.clientId !== session.clientId) {
    return NextResponse.json({ error: "Message introuvable." }, { status: 404 });
  }

  const formulaire = await req.formData().catch(() => null);
  const fichier = formulaire?.get("fichier");
  if (!(fichier instanceof File)) {
    return NextResponse.json({ error: "Fichier requis." }, { status: 400 });
  }

  const octets = Buffer.from(await fichier.arrayBuffer());
  const validation = validerPieceJointe(fichier.type, octets);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.erreur }, { status: 400 });
  }

  let fileUrl: string;
  try {
    const resultat = await uploaderFichier(fichier.name, new Blob([octets], { type: fichier.type }), "pieces-jointes");
    fileUrl = resultat.url;
  } catch {
    return NextResponse.json({ error: "Stockage indisponible, réessayez plus tard." }, { status: 503 });
  }

  const piece = await prisma.pieceJointe.create({
    data: {
      messageId: message.id,
      nomFichier: fichier.name,
      mimeType: fichier.type,
      tailleOctets: octets.length,
      hash: calculerHashPieceJointe(octets),
      fileUrl,
    },
  });

  // Jamais fileUrl dans la réponse (voir lib/storage.ts : tout accès passe
  // par une route authentifiée dédiée, voir GET .../pieces-jointes/[id]/fichier).
  return NextResponse.json(
    {
      id: piece.id,
      nomFichier: piece.nomFichier,
      mimeType: piece.mimeType,
      tailleOctets: piece.tailleOctets,
      createdAt: piece.createdAt,
    },
    { status: 201 }
  );
}
