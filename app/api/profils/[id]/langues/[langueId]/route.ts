import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { corrigerLangueSchema, premierMessageZod } from "@/lib/validation";

// ENGINEER PROFILE V2 — Lot 5. Symétrique de .../certifications/[id] pour
// LangueParlee — seule route pouvant passer le statut à VERIFIE. IDOR : la
// langue doit appartenir au profil de l'URL, sinon 404.
export async function PATCH(req: NextRequest, { params }: { params: { id: string; langueId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const corps = await req.json();
  const analyse = corrigerLangueSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  const avant = await prisma.langueParlee.findUnique({ where: { id: params.langueId } });
  if (!avant || avant.profilId !== params.id) {
    return NextResponse.json({ error: "Langue introuvable pour ce profil" }, { status: 404 });
  }

  const donnees = analyse.data;
  const apres = await prisma.langueParlee.update({
    where: { id: params.langueId },
    data: {
      statut: donnees.statut,
      source: donnees.statut === "VERIFIE" ? "ADMIN" : avant.source,
      niveau: donnees.niveau !== undefined ? donnees.niveau : avant.niveau,
      detail: donnees.detail ?? avant.detail,
    },
  });

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "talent.langue.corrigee",
    cible: `profil:${params.id}:langue:${params.langueId}`,
    detail: `${avant.langue}: statut ${avant.statut} -> ${apres.statut}`,
  });

  return NextResponse.json(apres);
}
