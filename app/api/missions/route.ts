import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculerTjmCout } from "@/app/api/profils/route";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (session.role === "CLIENT") {
    // le client a son propre endpoint filtré : /api/client/missions
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

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json();
  if (!body.clientId || !body.profilId || !body.nbJours || !body.tjmVente) {
    return NextResponse.json(
      { error: "clientId, profilId, nbJours et tjmVente sont requis" },
      { status: 400 }
    );
  }

  const mission = await prisma.mission.create({
    data: {
      clientId: body.clientId,
      profilId: body.profilId,
      repere: body.repere ?? null,
      nbJours: body.nbJours,
      margeCible: body.margeCible ?? 0.3,
      tjmVente: body.tjmVente,
    },
  });
  return NextResponse.json(mission, { status: 201 });
}
