import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Toutes les données affichées sur la page profil de l'ingénieur
// (voir /ingenieur) : informations issues du CV, disponibilité, missions
// avec Atlas, et référence au CV importé.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const profil = await prisma.profil.findUnique({
    where: { id: session.profilId },
    select: {
      nom: true,
      cvNomFichier: true,
      cvImporteLe: true,
      disponibilite: true,
      changerMissionActuelle: true,
      missionApres: true,
      preavis: true,
      preavisPrecision: true,
      disponibiliteRenseigneeLe: true,
      infosCv: { orderBy: { ordre: "asc" } },
      missions: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          repere: true,
          statut: true,
          nbJours: true,
          createdAt: true,
          client: { select: { nom: true } },
        },
      },
    },
  });

  if (!profil) {
    return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });
  }

  return NextResponse.json(profil);
}
