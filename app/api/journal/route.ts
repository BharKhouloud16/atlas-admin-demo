import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Journal d'audit des actions administratives sensibles — voir
// JournalActivite dans prisma/schema.prisma et lib/audit.ts. Réservé à
// l'Admin. Pas listé dans middleware.ts (comme /api/evaluations et
// consorts) : la vérification de session se fait ici, dans la route
// elle-même, comme le reste de l'API.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const entrees = await prisma.journalActivite.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ entrees });
}
