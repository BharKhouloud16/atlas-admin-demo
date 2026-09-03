import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { DISPONIBILITES, STATUTS_EN_MISSION, MISSIONS_APRES, PREAVIS } from "@/lib/disponibilite";
import { PAYS, NATIONALITES, DEVISES, calculerRegimeSuggere } from "@/lib/localisation";
import { TOUTES_COMPETENCES } from "@/lib/competences";

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
      disponibilitePrevue: true,
      changerMissionActuelle: true,
      missionApres: true,
      preavis: true,
      preavisPrecision: true,
      nationalite: true,
      nationalitePrecision: true,
      paysResidence: true,
      paysResidencePrecision: true,
      regimeSuggere: true,
      tjmSouhaite: true,
      tjmSouhaiteDevise: true,
      questionnaireValide: true,
      competences: true,
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
    disponibilitePrevue,
    changerMissionActuelle,
    missionApres,
    preavis,
    preavisPrecision,
    nationalite,
    nationalitePrecision,
    paysResidence,
    paysResidencePrecision,
    tjmSouhaite,
    tjmSouhaiteDevise,
    competences,
  } = body;

  if (!DISPONIBILITES.includes(disponibilite)) {
    return NextResponse.json({ error: "Statut de disponibilité invalide." }, { status: 400 });
  }
  const enMission = STATUTS_EN_MISSION.includes(disponibilite);
  if (enMission) {
    if (typeof changerMissionActuelle !== "boolean") {
      return NextResponse.json({ error: "Merci de préciser si vous souhaitez changer de mission." }, { status: 400 });
    }
    if (!MISSIONS_APRES.includes(missionApres)) {
      return NextResponse.json({ error: "Merci de préciser votre situation après la mission actuelle." }, { status: 400 });
    }
  }
  if (disponibilite === "Non disponible immédiatement" && !disponibilitePrevue?.trim()) {
    return NextResponse.json({ error: "Merci d'indiquer votre prévision de disponibilité." }, { status: 400 });
  }
  if (!PREAVIS.includes(preavis)) {
    return NextResponse.json({ error: "Préavis invalide." }, { status: 400 });
  }
  if (preavis === "Autre" && !preavisPrecision?.trim()) {
    return NextResponse.json({ error: "Merci de préciser votre préavis." }, { status: 400 });
  }
  if (!NATIONALITES.includes(nationalite)) {
    return NextResponse.json({ error: "Nationalité invalide." }, { status: 400 });
  }
  if (nationalite === "Autre" && !nationalitePrecision?.trim()) {
    return NextResponse.json({ error: "Merci de préciser votre nationalité." }, { status: 400 });
  }
  if (!PAYS.includes(paysResidence)) {
    return NextResponse.json({ error: "Pays de résidence invalide." }, { status: 400 });
  }
  if (paysResidence === "Autre" && !paysResidencePrecision?.trim()) {
    return NextResponse.json({ error: "Merci de préciser votre pays de résidence." }, { status: 400 });
  }
  const tjmNombre = Number(tjmSouhaite);
  if (!Number.isFinite(tjmNombre) || tjmNombre <= 0) {
    return NextResponse.json({ error: "Merci d'indiquer votre prétention salariale (TJM souhaité)." }, { status: 400 });
  }
  if (!DEVISES.includes(tjmSouhaiteDevise)) {
    return NextResponse.json({ error: "Devise invalide." }, { status: 400 });
  }
  // Compétences : liste fermée (voir lib/competences.ts). Champ optionnel —
  // on ignore silencieusement toute valeur qui ne fait pas partie de la
  // liste proposée plutôt que de bloquer l'enregistrement.
  const competencesValidees = Array.isArray(competences)
    ? competences.filter((c: unknown): c is string => typeof c === "string" && TOUTES_COMPETENCES.includes(c))
    : [];

  await prisma.profil.update({
    where: { id: session.profilId },
    data: {
      disponibilite,
      disponibilitePrevue: disponibilite === "Non disponible immédiatement" ? disponibilitePrevue.trim() : null,
      changerMissionActuelle: enMission ? changerMissionActuelle : null,
      missionApres: enMission ? missionApres : null,
      preavis,
      preavisPrecision: preavis === "Autre" ? preavisPrecision.trim() : null,
      nationalite,
      nationalitePrecision: nationalite === "Autre" ? nationalitePrecision.trim() : null,
      paysResidence,
      paysResidencePrecision: paysResidence === "Autre" ? paysResidencePrecision.trim() : null,
      regimeSuggere: calculerRegimeSuggere(paysResidence, nationalite),
      tjmSouhaite: tjmNombre,
      tjmSouhaiteDevise,
      competences: competencesValidees,
      disponibiliteRenseigneeLe: new Date(),
      questionnaireValide: true,
    },
  });

  return NextResponse.json({ ok: true });
}
