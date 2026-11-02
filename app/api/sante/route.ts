import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { identifierCibleBase } from "@/lib/db-target";
import { estIndisponibiliteBase, resumeErreurJournalisable } from "@/lib/db-errors";

// V1 — diagnostic de santé, en lecture seule (SELECT 1, aucune écriture).
// Permet d'établir, pour CHAQUE environnement déployé (Production, Preview),
// si la base répond et laquelle est réellement ciblée à l'exécution, sans
// exposer de secret (voir lib/db-target.ts). Jamais mis en cache.
export const dynamic = "force-dynamic";

export async function GET() {
  const cible = identifierCibleBase(process.env.DATABASE_URL);
  const environnement = process.env.VERCEL_ENV ?? (process.env.CI ? "ci" : process.env.NODE_ENV ?? "inconnu");
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;

  let base: "ok" | "indisponible" | "erreur" = "ok";
  let detail: string | null = null;
  const debut = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (erreur) {
    base = estIndisponibiliteBase(erreur) ? "indisponible" : "erreur";
    detail = resumeErreurJournalisable(erreur);
    console.error(`[/api/sante] base ${base} : ${detail}`);
  }

  return NextResponse.json(
    { statut: base === "ok" ? "ok" : "degrade", environnement, commit, base, detail, latenceMs: Date.now() - debut, cible },
    { status: base === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
