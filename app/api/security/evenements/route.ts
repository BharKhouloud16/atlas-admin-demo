import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ATLAS OS — TRUST & SECURITY INTELLIGENCE FOUNDATION (Batch 16, 08/09/2026).
// Lecture seule des derniers événements de sécurité (EvenementSecurite) —
// réservé ADMIN, même discipline que /api/security (B13.9) : aucune
// donnée exposée au Client ou à l'Ingénieur, gestion d'erreur générique
// sans fuite de détail, seul GET est exporté (405 natif sur le reste).
// Aucune donnée sensible à filtrer : EvenementSecurite ne stocke jamais de
// mot de passe/token/secret (voir lib/security/events.ts).
//
// Le filtre acteurEmail a été ajouté après un test CI instable (B16) :
// sous exécution parallèle, plusieurs suites de tests génèrent des
// événements rbac.acces_refuse simultanément, et un simple LIMIT sur
// action seule pouvait laisser passer l'événement recherché hors de la
// fenêtre des N plus récents. Filtrer aussi par acteur rend la requête
// déterministe sans changer le modèle de données ni la sécurité.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") ?? undefined;
    const resultat = searchParams.get("resultat") ?? undefined;
    const acteurEmail = searchParams.get("acteurEmail") ?? undefined;
    const limiteBrute = Number(searchParams.get("limite"));
    const limite = Number.isFinite(limiteBrute) && limiteBrute > 0 ? Math.min(limiteBrute, 200) : 100;

    const evenements = await prisma.evenementSecurite.findMany({
      where: {
        ...(action ? { action } : {}),
        ...(resultat && ["SUCCES", "REFUSE", "ERREUR"].includes(resultat)
          ? { resultat: resultat as "SUCCES" | "REFUSE" | "ERREUR" }
          : {}),
        ...(acteurEmail ? { acteurEmail } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limite,
    });

    return NextResponse.json({ evenements });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la lecture des événements de sécurité." }, { status: 500 });
  }
}
