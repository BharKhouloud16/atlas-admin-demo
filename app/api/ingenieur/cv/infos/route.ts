import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

async function requireIngenieur() {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) return null;
  return session;
}

// Liste les champs extraits du CV, dans l'ordre, pour la page de validation
// pas-à-pas.
export async function GET() {
  const session = await requireIngenieur();
  if (!session) return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });

  const infos = await prisma.infoCV.findMany({
    where: { profilId: session.profilId! },
    orderBy: { ordre: "asc" },
  });
  return NextResponse.json(infos);
}

// Met à jour la valeur d'un champ (correction éventuelle) et/ou le marque
// comme validé ("OK") — appelé un champ à la fois pendant la vérification.
export async function PATCH(req: NextRequest) {
  const session = await requireIngenieur();
  if (!session) return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });

  const { id, valeur, valide } = await req.json();
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const info = await prisma.infoCV.findUnique({ where: { id } });
  if (!info || info.profilId !== session.profilId) {
    return NextResponse.json({ error: "Champ introuvable" }, { status: 404 });
  }

  const updated = await prisma.infoCV.update({
    where: { id },
    data: {
      ...(valeur !== undefined ? { valeur } : {}),
      ...(valide !== undefined ? { valide } : {}),
    },
  });

  return NextResponse.json(updated);
}
