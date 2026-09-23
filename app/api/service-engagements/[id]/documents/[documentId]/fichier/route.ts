import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { obtenirFichier } from "@/lib/storage";

// PHASE 7 — Service OS Foundation. Sert un Document rattaché à un
// ServiceEngagement pour l'Admin — même discipline que
// app/api/client/documents/[id]/fichier/route.ts : jamais l'URL de
// stockage brute, ownership revérifiée en base avant tout accès au
// stockage, 404 (jamais une fuite d'existence) si le document n'appartient
// pas à ce ServiceEngagement.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { id, documentId } = await params;
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { serviceEngagementId: true, fileUrl: true, titre: true },
  });
  if (!document || document.serviceEngagementId !== id) {
    return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
  }

  let fichier: Awaited<ReturnType<typeof obtenirFichier>>;
  try {
    fichier = await obtenirFichier(document.fileUrl);
  } catch {
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
