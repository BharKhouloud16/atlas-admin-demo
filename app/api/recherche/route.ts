import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Recherche globale admin (façon barre de recherche Bullhorn/Boond) —
// interroge clients, profils (ingénieurs) et missions en une seule requête
// plutôt que de forcer l'Admin à ouvrir 3 pages différentes pour retrouver
// une entité par son nom. Réservé à l'Admin, comme le reste de /admin.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ clients: [], profils: [], missions: [] });
  }

  const [clients, profils, missions] = await Promise.all([
    prisma.client.findMany({
      where: {
        OR: [
          { nom: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { contactReferent: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, nom: true, email: true, secteur: true },
      take: 10,
    }),
    prisma.profil.findMany({
      where: {
        OR: [
          { nom: { contains: q, mode: "insensitive" } },
          { prenom: { contains: q, mode: "insensitive" } },
          { competences: { has: q } },
        ],
      },
      select: { id: true, nom: true, prenom: true, seniorite: true, disponibilite: true },
      take: 10,
    }),
    prisma.mission.findMany({
      where: {
        OR: [
          { repere: { contains: q, mode: "insensitive" } },
          { client: { nom: { contains: q, mode: "insensitive" } } },
          { profil: { nom: { contains: q, mode: "insensitive" } } },
        ],
      },
      select: {
        id: true,
        repere: true,
        statut: true,
        client: { select: { nom: true } },
        profil: { select: { nom: true, prenom: true } },
      },
      take: 10,
    }),
  ]);

  return NextResponse.json({ clients, profils, missions });
}
