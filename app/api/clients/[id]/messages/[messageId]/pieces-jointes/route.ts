import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { uploaderFichier } from "@/lib/storage";
import { validerPieceJointe, calculerHashPieceJointe } from "@/lib/piece-jointe";

// COMPANY ATLAS — V2.4 : Pièces jointes sécurisées (Lot 2) — upload Admin.
//
// Pendant Admin de POST /api/client/messages/[id]/pieces-jointes. [id] =
// Client.id (jamais du corps), [messageId] = Message.id — la cohérence
// entre les deux est revérifiée en base (message.clientId === id) avant
// tout upload, même si l'Admin fournissait un couple incohérent : 404,
// jamais une fuite d'existence, même discipline que
// app/api/clients/[id]/messages/route.ts. Réservé ADMIN — jamais
// INGENIEUR, même si le middleware laisse passer /api/clients/* pour ce
// rôle (voir commentaire de la route Message existante) : re-vérifié ici
// en défense en profondeur.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { id, messageId } = await params;
  const client = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!client) {
    return NextResponse.json({ error: "Client introuvable." }, { status: 404 });
  }
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { id: true, clientId: true } });
  if (!message || message.clientId !== id) {
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
