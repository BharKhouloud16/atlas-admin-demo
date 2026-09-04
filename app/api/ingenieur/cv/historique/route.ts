import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Historique des versions du CV (voir prisma/schema.prisma, VersionCv, et
// POST /api/ingenieur/cv qui archive l'ancienne version à chaque réimport).
// Accessible à l'ingénieur propriétaire (sans ?profilId) ou à un Admin
// consultant un profil (?profilId=...) — même règle d'accès que le CV
// actuel (voir GET /api/ingenieur/cv/fichier).
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
  }

  if (!profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const versions = await prisma.versionCv.findMany({
    where: { profilId },
    orderBy: { importeLe: "desc" },
    select: { id: true, cvNomFichier: true, importeLe: true },
  });

  return NextResponse.json({ versions });
}
