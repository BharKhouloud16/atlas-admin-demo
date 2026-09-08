import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculerTjmCout } from "@/lib/calculs";
import { getSession } from "@/lib/auth";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";

// FIX B17 (08/09/2026) — GET/POST prennent désormais `req: NextRequest`
// (au lieu de `()` / déjà présent pour POST) pour pouvoir journaliser
// l'IP sur un refus RBAC. Les contrôles de rôle ci-dessous existaient déjà
// avant B17 ; seule la journalisation est nouvelle — voir middleware.ts
// (FIX B17) pour l'explication de la faille de traçabilité corrigée
// (ces contrôles étaient inatteignables pour CLIENT car bloqué en amont
// par le middleware, donc jamais journalisés jusqu'ici).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (session.role === "CLIENT") {
    // le client a son propre endpoint filtré : /api/client/missions
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions",
      acteurEmail: session.email,
      acteurRole: session.role,
      ressourceType: "Mission",
      detail: "Tentative d'accès à la liste complète des missions par un rôle Client (endpoint réservé Admin/Ingénieur, voir /api/client/missions).",
    });
    return NextResponse.json({ error: "Utilisez /api/client/missions" }, { status: 403 });
  }

  const missions = await prisma.mission.findMany({
    // INGENIEUR : uniquement les missions liées à son propre profil
    where: session.role === "INGENIEUR" && session.profilId ? { profilId: session.profilId } : {},
    include: { client: true, profil: true },
    orderBy: { createdAt: "desc" },
  });

  const hyp = await prisma.hypotheses.upsert({ where: { id: "singleton" }, update: {}, create: {} });

  const enrichies = missions.map((m) => {
    // INGENIEUR : ne voit ni tarifs, ni marges, ni coûts — seulement le
    // déroulé opérationnel de sa propre mission.
    if (session.role === "INGENIEUR") {
      return {
        id: m.id,
        repere: m.repere,
        nbJours: m.nbJours,
        statut: m.statut,
        client: { nom: m.client.nom },
      };
    }

    // ADMIN : accès complet
    const tjmCout = calculerTjmCout(m.profil.type, m.profil.montantSaisi, hyp);
    const tjmCoutOverhead = tjmCout != null ? tjmCout * (1 + hyp.overhead) : null;
    const ca = m.tjmVente * m.nbJours;
    const coutTotal = tjmCoutOverhead != null ? tjmCoutOverhead * m.nbJours : null;
    const margeEuros = coutTotal != null ? ca - coutTotal : null;
    const margePct = margeEuros != null && ca > 0 ? margeEuros / ca : null;
    return { ...m, tjmCout, tjmCoutOverhead, ca, coutTotal, margeEuros, margePct };
  });

  return NextResponse.json(enrichies);
}

// Devises acceptées pour deviseVente — mêmes codes que TAUX_REPLI dans
// lib/taux-change.ts, pour rester cohérent avec le reste de la plateforme.
const DEVISES_ACCEPTEES = ["EUR", "USD", "GBP", "CHF", "MAD", "TND", "DZD", "AED", "SAR", "QAR", "CAD"];

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Mission",
      detail: "Tentative de création de mission par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json();
  if (!body.clientId || !body.profilId || !body.nbJours || !body.tjmVente) {
    return NextResponse.json(
      { error: "clientId, profilId, nbJours et tjmVente sont requis" },
      { status: 400 }
    );
  }

  // deviseVente optionnel — défaut EUR (même comportement qu'avant l'ajout
  // du champ, voir prisma/schema.prisma) si absent ou non reconnu.
  const deviseDemandee = typeof body.deviseVente === "string" ? body.deviseVente.trim().toUpperCase() : "";
  const deviseVente = DEVISES_ACCEPTEES.includes(deviseDemandee) ? deviseDemandee : "EUR";

  const mission = await prisma.mission.create({
    data: {
      clientId: body.clientId,
      profilId: body.profilId,
      repere: body.repere ?? null,
      nbJours: body.nbJours,
      margeCible: body.margeCible ?? 0.3,
      tjmVente: body.tjmVente,
      deviseVente,
    },
  });
  return NextResponse.json(mission, { status: 201 });
}
