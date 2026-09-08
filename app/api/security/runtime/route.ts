import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculerSignauxRuntime } from "@/lib/security/runtime-signals";
import { construireRisquesDepuisSignaux } from "@/lib/security/runtime-risk";

// ATLAS OS — TRUST & SECURITY INTELLIGENCE FOUNDATION (Batch 16, 08/09/2026).
// Assemble la chaîne FACT -> SIGNAL -> RISK (directive B16, section 5) à
// partir des événements de sécurité réels des dernières 24h — réservé
// ADMIN, lecture seule, même discipline que /api/security (B13.9) :
// - ZÉRO score global, zéro verdict de synthèse : les risques restent
//   UNKNOWN par défaut (voir lib/security/runtime-risk.ts), une absence de
//   signal ne signifie pas absence de menace, seulement absence de seuil
//   franchi sur les événements déjà journalisés.
// - Gestion d'erreur générique sans fuite de détail interne.
// - Seul GET exporté (405 natif sur le reste).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const horizon = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const evenementsBruts = await prisma.evenementSecurite.findMany({
      where: { createdAt: { gte: horizon } },
      select: { action: true, resultat: true, acteurEmail: true, contexteIp: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const signaux = calculerSignauxRuntime(evenementsBruts, new Date());
    const risques = construireRisquesDepuisSignaux(signaux);

    return NextResponse.json({
      avertissement:
        "Signaux calculés par règles explicites (seuils fixes) sur les événements de sécurité des dernières 24h, fenêtre glissante de 15 minutes par règle. Absence de signal ne signifie pas absence de menace — uniquement l'absence de seuil franchi sur les événements déjà journalisés (voir lib/security/events.ts pour ce qui est actuellement instrumenté).",
      fenetreAnalysee: { depuis: horizon.toISOString(), evenementsConsideres: evenementsBruts.length },
      signaux,
      risques,
    });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors du calcul des signaux de sécurité." }, { status: 500 });
  }
}
