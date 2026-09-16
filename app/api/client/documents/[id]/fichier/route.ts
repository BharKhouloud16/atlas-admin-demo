import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { obtenirFichier } from "@/lib/storage";

// CLIENT COMPLETION PROGRAM — C6 (16/09/2026).
//
// Sert un Document du client authentifié — jamais l'URL de stockage brute
// (voir le commentaire de lib/storage.ts : "ne jamais exposer directement
// l'URL renvoyée par uploaderFichier()"). Ownership revérifiée en base
// (document.clientId === session.clientId) avant tout accès au stockage —
// 404 (jamais une fuite d'existence) si le document n'appartient pas au
// client courant, même discipline que /api/evaluations,
// /api/feuilles-de-temps.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const { id } = await params;
  const document = await prisma.document.findUnique({
    where: { id },
    select: { clientId: true, fileUrl: true, titre: true },
  });
  if (!document || document.clientId !== session.clientId) {
    return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
  }

  let fichier: Awaited<ReturnType<typeof obtenirFichier>>;
  try {
    fichier = await obtenirFichier(document.fileUrl);
  } catch {
    // Stockage indisponible (ex. BLOB_READ_WRITE_TOKEN non configuré) —
    // jamais une page d'erreur 500 non gérée pour un cas déjà documenté
    // comme une dépendance de déploiement (voir lib/storage.ts).
    return NextResponse.json({ error: "Stockage indisponible." }, { status: 503 });
  }
  if (!fichier) {
    return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
  }

  return new NextResponse(fichier.stream, {
    headers: {
      "Content-Type": fichier.contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
      "Content-Disposition": `attachment; filename="${document.titre}"`,
    },
  });
}
