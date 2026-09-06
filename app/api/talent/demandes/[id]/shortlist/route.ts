import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { premierMessageZod } from "@/lib/validation";

// Validation humaine (human-in-the-loop) d'une entrée de shortlist proposée
// par le Matching Engine — jamais automatique. Réservé à l'Admin. Chaque
// décision est journalisée (voir lib/audit.ts, JournalActivite) comme les
// autres actions sensibles du projet (validation de compte, rejet de CRA).
const decisionSchema = z.object({
  profilId: z.string().min(1),
  decision: z.enum(["VALIDEE", "REJETEE"]),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const corps = await req.json();
  const analyse = decisionSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const { profilId, decision } = analyse.data;

  const entree = await prisma.shortlistEntree.findUnique({
    where: { demandeId_profilId: { demandeId: params.id, profilId } },
  });
  if (!entree) {
    return NextResponse.json({ error: "Entrée de shortlist introuvable" }, { status: 404 });
  }

  const misAJour = await prisma.shortlistEntree.update({
    where: { id: entree.id },
    data: { statut: decision, valideParEmail: session.email, valideLe: new Date() },
  });

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: decision === "VALIDEE" ? "shortlist.validee" : "shortlist.rejetee",
    cible: `demande:${params.id} profil:${profilId}`,
    detail: `Score ${entree.score}, confiance ${entree.confiance}`,
  });

  return NextResponse.json(misAJour);
}
