import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { certificationSchema, premierMessageZod } from "@/lib/validation";

// ENGINEER PROFILE V2 — Lot 5. Auto-déclaration par l'Ingénieur, exactement
// comme Profil.competences (case cochée) : statut toujours DECLARE, source
// PROFIL — "Une certification mentionnée dans un CV n'est pas automatiquement
// authentifiée" (mandat CEO) : seule une correction Admin explicite (voir
// PATCH /api/profils/[id]/certifications/[certificationId]) peut passer à
// VERIFIE. Réservé au propriétaire (session.profilId), jamais un autre
// profilId accepté depuis le corps.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }
  const certifications = await prisma.certification.findMany({
    where: { profilId: session.profilId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(certifications);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const corps = await req.json();
  const analyse = certificationSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const donnees = analyse.data;

  const certification = await prisma.certification.create({
    data: {
      profilId: session.profilId,
      nom: donnees.nom,
      organisme: donnees.organisme ?? null,
      source: "PROFIL",
      statut: "DECLARE",
      obtenueLe: donnees.obtenueLe ? new Date(donnees.obtenueLe) : null,
      expireLe: donnees.expireLe ? new Date(donnees.expireLe) : null,
      detail: donnees.detail ?? null,
    },
  });

  return NextResponse.json(certification, { status: 201 });
}
