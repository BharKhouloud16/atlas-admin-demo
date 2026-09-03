import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { DISPONIBILITES, MISSIONS_APRES, PREAVIS } from "@/lib/disponibilite";

// Questionnaire de disponibilité, à remplir par l'ingénieur juste après la
// validation de son CV (voir /ingenieur/disponibilite), avant d'accéder à
// son espace (voir app/ingenieur/layout.tsx).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const profil = await prisma.profil.findUnique({
    where: { id: session.profilId },
    select: {
      disponibilite: true,
      changerMissionActuelle: true,
      missionApres: true,
      preavis: true,
      preavisPrecision: true,
      questionnaireValide: true,
    },
  });

  return NextResponse.json(profil);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const body = await req.json();
  const { disponibilite, changerMissionActuelle, missionApres, preavis, preavisPrecision } = body;

  if (!DISPONIBILITES.includes(disponibilite)) {
    return NextResponse.json({ error: "Statut de disponibilité invalide." }, { status: 400 });
  }
  if (disponibilite === "En mission actuellement") {
    if (typeof changerMissionActuelle !== "boolean") {
      return NextResponse.json({ error: "Merci de préciser si vous souhaitez changer de mission." }, { status: 400 });
    }
    if (!MISSIONS_APRES.includes(missionApres)) {
      return NextResponse.json({ error: "Merci de préciser votre situation après la mission actuelle." }, { status: 400 });
    }
  }
  if (!PREAVIS.includes(preavis)) {
    return NextResponse.json({ error: "Préavis invalide." }, { status: 400 });
  }
  if (preavis === "Autre" && !preavisPrecision?.trim()) {
    return NextResponse.json({ error: "Merci de préciser votre préavis." }, { status: 400 });
  }

  await prisma.profil.update({
    where: { id: session.profilId },
    data: {
      disponibilite,
      changerMissionActuelle: disponibilite === "En mission actuellement" ? changerMissionActuelle : null,
      missionApres: disponibilite === "En mission actuellement" ? missionApres : null,
      preavis,
      preavisPrecision: preavis === "Autre" ? preavisPrecision.trim() : null,
      disponibiliteRenseigneeLe: new Date(),
      questionnaireValide: true,
    },
  });

  return NextResponse.json({ ok: true });
}
