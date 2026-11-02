import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { validerCriteresDeclares } from "@/lib/client-need/criteres-declares";
import { preparerNouveauBesoin } from "@/lib/client-need/creation";

// COMPANY ATLAS — LOT 2 : Client Need Intelligence Foundation (15/09/2026).
//
// Réservé CLIENT — même discipline que /api/client/missions et
// /api/client/documents (non modifiées) : clientId dérivé EXCLUSIVEMENT de
// session.clientId, jamais accepté depuis le corps de la requête. Le seul
// input client réel est `texteOriginal` (et `titre`, facultatif) — tout le
// reste (faits extraits, cohérence, provenance) est calculé côté serveur.
//
// GUARD ALLOW ≠ EXECUTEE (B27) n'a pas d'équivalent ici : ce lot ne câble
// AUCUNE logique commerciale Talent/ATLAS OS, aucune décision irréversible
// — juste la création d'un enregistrement de compréhension, jamais une
// action métier contrôlée par le Control Plane (B22-B32 non concernés).

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const besoins = await prisma.clientNeed.findMany({
    where: { clientId: session.clientId },
    include: {
      faits: true,
      // LOT 6 : profondeur supplémentaire uniquement pour dériver
      // missionEnCours — jamais les champs internes de Mission (tarifs,
      // marge, profil ingénieur) ne sont sélectionnés ici.
      demandeTalentCreee: { select: { id: true, missions: { select: { id: true } } } },
      // REV-01 (01/11/2026) : signale le projet porté par ce besoin.
      projet: { select: { id: true, titre: true, statut: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // LOT 5/6 : dérivé des relations sourceNeedId/sourceDemandeId (jamais un
  // nouveau statut persisté) — indique uniquement qu'une démarche Talent a
  // été engagée puis qu'une Mission en a résulté, jamais les données
  // internes de la DemandeTalent/Mission elles-mêmes (budget, scores,
  // tarifs, notes Admin — minimisation des données, directive LOT 5/6).
  return NextResponse.json({
    besoins: besoins.map(({ demandeTalentCreee, ...besoin }) => ({
      ...besoin,
      demarcheTalentEngagee: demandeTalentCreee !== null,
      missionEnCours: (demandeTalentCreee?.missions.length ?? 0) > 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => null);
    const texteOriginal = body?.texteOriginal;
    if (typeof texteOriginal !== "string" || texteOriginal.trim().length < 10) {
      return NextResponse.json({ error: "texteOriginal requis (10 caractères minimum)." }, { status: 400 });
    }
    if (texteOriginal.length > 4000) {
      return NextResponse.json({ error: "texteOriginal ne doit jamais dépasser 4000 caractères." }, { status: 400 });
    }
    const titre = typeof body?.titre === "string" && body.titre.trim().length > 0 ? body.titre.trim().slice(0, 200) : null;
    // LOT 7 (01/11/2026) : critères déclarés dans l'assistant (facultatifs,
    // validés côté serveur). Un appel sans `criteres` se comporte comme avant.
    const criteres = validerCriteresDeclares(body?.criteres);
    if (!criteres.ok) return NextResponse.json({ error: criteres.erreur }, { status: 400 });

    // LOT 6 (28/10/2026) : préparation factorisée dans
    // lib/client-need/creation.ts (réutilisée par les projets complets),
    // comportement inchangé.
    const besoin = await prisma.clientNeed.create({
      data: await preparerNouveauBesoin({ clientId: session.clientId, texteOriginal, titre, faitsSupplementaires: criteres.faits }),
      include: { faits: true },
    });

    return NextResponse.json({ besoin }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la création du besoin." }, { status: 500 });
  }
}
