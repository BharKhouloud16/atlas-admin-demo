import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { obtenirTauxChange } from "@/lib/taux-change";

// Expose les taux de change du jour (voir lib/taux-change.ts) à
// /admin/profils, pour convertir le TJM souhaité de l'ingénieur en euros
// avec des taux live plutôt que figés en dur côté client. Réservé à
// l'Admin, comme le reste de /admin/profils.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const { taux, source, recupereLe } = await obtenirTauxChange();
  return NextResponse.json({ taux, source, recupereLe });
}
