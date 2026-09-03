import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { DISPONIBILITES, MISSIONS_APRES, PREAVIS } from "@/lib/disponibilite";
import { PAYS, calculerRegimeSuggere } from "@/lib/localisation";

// Questionnaire de disponibilité, à remplir par l'ingénieur juste après la
// validation de son CV (voir /ingenieur/disponibilite), avant d'accéder à
// son espace (voir app/ingenieur/page.tsx). Réutilisé pour l'édition
// ultérieure depuis l'onglet Profil (voir EspaceIngenieur.tsx).
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
      nationalite: true,
      paysResidence: true,
      paysResidencePrecision: true,
      regimeSuggere: true,
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
  const {
    disponibilite,
    changerMissionActuelle,
    missionApres,
    preavis,
    preavisPrecision,
    nationalite,
    paysResidence,
    paysResidencePrecision,
  } = body;

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
  if (typeof nationalite !== "string" || !nationalite.trim()) {
    return NextResponse.json({ error: "Merci de renseigner votre nationalité." }, { status: 400 });
  }
  if (!PAYS.includes(paysResidence)) {
    return NextResponse.json({ error: "Pays de résidence invalide." }, { status: 400 });
  }
  if (paysResidence === "Autre" && !paysResidencePrecision?.trim()) {
    return NextResponse.json({ error: "Merci de préciser votre pays de résidence." }, { status: 400 });
  }

  await prisma.profil.update({
    where: { id: session.profilId },
    data: {
      disponibilite,
      changerMissionActuelle: disponibilite === "En mission actuellement" ? changerMissionActuelle : null,
      missionApres: disponibilite === "En mission actuellement" ? missionApres : null,
      preavis,
      preavisPrecision: preavis === "Autre" ? preavisPrecision.trim() : null,
      nationalite: nationalite.trim(),
      paysResidence,
      paysResidencePrecision: paysResidence === "Autre" ? paysResidencePrecision.trim() : null,
      regimeSuggere: calculerRegimeSuggere(paysResidence),
      disponibiliteRenseigneeLe: new Date(),
      questionnaireValide: true,
    },
  });

  return NextResponse.json({ ok: true });
}
