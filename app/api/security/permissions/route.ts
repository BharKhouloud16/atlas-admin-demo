import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listerPermissionsAgent } from "@/lib/agents/permissions";

// COMPANY ATLAS — B20 (09/09/2026) : lecture SEULE du Permission Registry
// (lib/agents/permissions.ts). Reservee ADMIN, meme discipline que
// /api/security/agents (B19) et les routes /api/security/* precedentes
// (B16-B19) : cette route ne figure PAS dans middleware.ts (aucune route
// sous /api/security ne l'a jamais ete), la protection est assuree ICI par
// getSession()+role.
//
// VOLONTAIREMENT AUCUNE ROUTE POST/PATCH/DELETE : les permissions initiales
// sont seedees une fois pour toutes par la migration Prisma (directive
// B20, regle 9 : "Aucune mutation de permission via API. Les permissions
// initiales sont controlees par migration."). Il n'existe structurellement
// aucun moyen, via cette API, de creer, modifier ou supprimer une
// permission.

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const permissions = await listerPermissionsAgent();
    return NextResponse.json({ permissions });
  } catch {
    return NextResponse.json({ error: "Erreur interne lors de la lecture du Permission Registry." }, { status: 500 });
  }
}
