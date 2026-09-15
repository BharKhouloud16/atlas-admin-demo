import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { extraireBesoinClient, CLES_IMPORTANTES_SI_ABSENTES } from "@/lib/client-need/extraction";
import { evaluerCoherenceBesoin } from "@/lib/client-need/coherence";
import { nouveauCorrelationId } from "@/lib/security/events";
import type { ClientNeedFaitCle } from "@prisma/client";

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
    include: { faits: true, demandeTalentCreee: { select: { id: true } } },
    orderBy: { createdAt: "desc" },
  });

  // LOT 5 : dérivé de la relation sourceNeedId (jamais un nouveau statut
  // persisté) — indique uniquement qu'une démarche Talent a été engagée,
  // jamais les données internes de la DemandeTalent elle-même (budget,
  // scores, notes Admin — minimisation des données, directive LOT 5).
  return NextResponse.json({
    besoins: besoins.map(({ demandeTalentCreee, ...besoin }) => ({
      ...besoin,
      demarcheTalentEngagee: demandeTalentCreee !== null,
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

    const extraction = await extraireBesoinClient(texteOriginal);

    // Complète les attributs importants non détectés par une ligne
    // INCONNU explicite plutôt que silencieuse (jamais une valeur
    // inventée) — voir lib/client-need/extraction.ts.
    const clesDetectees = new Set(extraction.faits.map((f) => f.cle));
    const faitsInconnus: { cle: ClientNeedFaitCle; valeur: string; statut: "INCONNU" }[] = CLES_IMPORTANTES_SI_ABSENTES.filter(
      (cle) => !clesDetectees.has(cle)
    ).map((cle) => ({ cle: cle as ClientNeedFaitCle, valeur: "", statut: "INCONNU" as const }));

    const coherence = evaluerCoherenceBesoin(extraction.faits);

    const correlationId = nouveauCorrelationId();
    const besoin = await prisma.clientNeed.create({
      data: {
        clientId: session.clientId,
        correlationId,
        texteOriginal,
        titre,
        statut: "SOUMIS",
        coherenceStatut: coherence.statut,
        coherenceDetail: coherence.detail,
        analyseProvider: extraction.provider,
        analyseeLe: new Date(),
        faits: {
          create: [
            ...extraction.faits.map((f) => ({ cle: f.cle as ClientNeedFaitCle, valeur: f.valeur, statut: f.statut, source: "extraction" })),
            ...faitsInconnus.map((f) => ({ cle: f.cle, valeur: f.valeur, statut: f.statut, source: null })),
          ],
        },
      },
      include: { faits: true },
    });

    return NextResponse.json({ besoin }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la création du besoin." }, { status: 500 });
  }
}
