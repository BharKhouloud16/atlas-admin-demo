import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { craEstEditableParIngenieur } from "@/lib/feuilles-de-temps";

// Feuilles de temps (CRA) : un seul endpoint, comportement différent selon
// le rôle (même approche que /api/missions) — voir lib/feuilles-de-temps.ts
// pour le circuit de statuts. L'Ingénieur crée/soumet, l'Admin valide ou
// rejette en premier, le Client valide en dernier avant facturation.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (session.role === "ADMIN") {
    const feuilles = await prisma.feuilleDeTemps.findMany({
      include: { mission: { include: { client: true, profil: true } } },
      orderBy: [{ statut: "asc" }, { mois: "desc" }],
    });
    return NextResponse.json({ feuilles });
  }

  if (session.role === "INGENIEUR") {
    if (!session.profilId) return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    const [missions, feuilles] = await Promise.all([
      prisma.mission.findMany({
        where: { profilId: session.profilId },
        select: { id: true, repere: true, statut: true, client: { select: { nom: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.feuilleDeTemps.findMany({
        where: { mission: { profilId: session.profilId } },
        include: { mission: { select: { id: true, repere: true, client: { select: { nom: true } } } } },
        orderBy: { mois: "desc" },
      }),
    ]);
    return NextResponse.json({ missions, feuilles });
  }

  if (session.role === "CLIENT") {
    if (!session.clientId) return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    const feuilles = await prisma.feuilleDeTemps.findMany({
      where: {
        mission: { clientId: session.clientId },
        statut: { in: ["ValideeAdmin", "ValideeClient"] },
      },
      include: { mission: { select: { id: true, repere: true, profil: { select: { nom: true } } } } },
      orderBy: { mois: "desc" },
    });
    return NextResponse.json({ feuilles });
  }

  return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
}

// Création/édition d'un brouillon + soumission — réservé à l'Ingénieur,
// uniquement sur ses propres missions.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const body = await req.json();
  const { missionId, mois, joursTravailles, heuresSupplementaires, commentaire, soumettre } = body;

  if (!missionId || !/^\d{4}-\d{2}$/.test(mois ?? "")) {
    return NextResponse.json({ error: "Mission et mois (AAAA-MM) requis." }, { status: 400 });
  }
  const jours = Number(joursTravailles);
  const heuresSup = Number(heuresSupplementaires) || 0;
  if (!Number.isFinite(jours) || jours < 0 || jours > 31) {
    return NextResponse.json({ error: "Nombre de jours travaillés invalide." }, { status: 400 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!mission || mission.profilId !== session.profilId) {
    return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });
  }

  const existante = await prisma.feuilleDeTemps.findUnique({
    where: { missionId_mois: { missionId, mois } },
  });
  if (existante && !craEstEditableParIngenieur(existante.statut)) {
    return NextResponse.json(
      { error: "Cette feuille de temps est déjà engagée dans le circuit de validation." },
      { status: 409 }
    );
  }

  const data = {
    missionId,
    mois,
    joursTravailles: jours,
    heuresSupplementaires: heuresSup,
    commentaire: commentaire?.trim() || null,
    statut: soumettre ? "Soumise" : "Brouillon",
    motifRejet: null as string | null,
    soumiseLe: soumettre ? new Date() : existante?.soumiseLe ?? null,
    valideeAdminLe: null as Date | null,
    valideeClientLe: null as Date | null,
  };

  const feuille = existante
    ? await prisma.feuilleDeTemps.update({ where: { id: existante.id }, data })
    : await prisma.feuilleDeTemps.create({ data });

  return NextResponse.json(feuille, { status: existante ? 200 : 201 });
}

// Validation Admin puis Client (ou rejet Admin) — voir lib/feuilles-de-temps.ts.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json();
  const { id, action, motifRejet } = body;
  if (!id || !action) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  const feuille = await prisma.feuilleDeTemps.findUnique({ where: { id }, include: { mission: true } });
  if (!feuille) return NextResponse.json({ error: "Feuille de temps introuvable." }, { status: 404 });

  if (session.role === "ADMIN") {
    if (feuille.statut !== "Soumise") {
      return NextResponse.json({ error: "Cette feuille n'est pas en attente de validation Admin." }, { status: 409 });
    }
    if (action === "validerAdmin") {
      const maj = await prisma.feuilleDeTemps.update({
        where: { id },
        data: { statut: "ValideeAdmin", valideeAdminLe: new Date() },
      });
      return NextResponse.json(maj);
    }
    if (action === "rejeter") {
      const maj = await prisma.feuilleDeTemps.update({
        where: { id },
        data: { statut: "Rejetee", motifRejet: (motifRejet ?? "").trim() || "Non précisé." },
      });
      return NextResponse.json(maj);
    }
    return NextResponse.json({ error: "Action invalide." }, { status: 400 });
  }

  if (session.role === "CLIENT") {
    if (!session.clientId || feuille.mission.clientId !== session.clientId) {
      return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    }
    if (feuille.statut !== "ValideeAdmin") {
      return NextResponse.json({ error: "Cette feuille n'est pas en attente de votre validation." }, { status: 409 });
    }
    if (action === "validerClient") {
      const maj = await prisma.feuilleDeTemps.update({
        where: { id },
        data: { statut: "ValideeClient", valideeClientLe: new Date() },
      });
      return NextResponse.json(maj);
    }
    return NextResponse.json({ error: "Action invalide." }, { status: 400 });
  }

  return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
}
