import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { corrigerCertificationSchema, premierMessageZod } from "@/lib/validation";

// ENGINEER PROFILE V2 — Lot 5. Correction Admin explicite d'une
// Certification — SEULE route pouvant passer le statut à VERIFIE, exactement
// le même principe que PATCH /api/profils/[id]/competences/[competenceId]
// pour le Skill Graph. IDOR : la certification doit appartenir au profil de
// l'URL, sinon 404 (jamais 403, pour ne pas confirmer son existence
// ailleurs).
export async function PATCH(req: NextRequest, { params }: { params: { id: string; certificationId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const corps = await req.json();
  const analyse = corrigerCertificationSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }

  const avant = await prisma.certification.findUnique({ where: { id: params.certificationId } });
  if (!avant || avant.profilId !== params.id) {
    return NextResponse.json({ error: "Certification introuvable pour ce profil" }, { status: 404 });
  }

  const donnees = analyse.data;
  const apres = await prisma.certification.update({
    where: { id: params.certificationId },
    data: {
      statut: donnees.statut,
      source: donnees.statut === "VERIFIE" ? "ADMIN" : avant.source,
      expireLe: donnees.expireLe !== undefined ? (donnees.expireLe ? new Date(donnees.expireLe) : null) : avant.expireLe,
      detail: donnees.detail ?? avant.detail,
    },
  });

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: "talent.certification.corrigee",
    cible: `profil:${params.id}:certification:${params.certificationId}`,
    detail: `${avant.nom}: statut ${avant.statut} -> ${apres.statut}`,
  });

  return NextResponse.json(apres);
}
