import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §15. `meetingExternalId` est un champ technique (idempotence de
// synchronisation calendrier) — jamais exposé au Client (§17).
// `meetingUrl` reste exposée : c'est le lien à communiquer aux
// participants, dont le Client sélectionné fait partie une fois
// l'Interview planifié.
export async function GET(_req: NextRequest, { params }: { params: { selectionId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const selection = await prisma.candidateSelection.findUnique({ where: { id: params.selectionId }, select: { id: true, demandeTalentId: true } });
  const demande =
    selection && (await prisma.demandeTalent.findFirst({ where: { id: selection.demandeTalentId, clientId: session.clientId }, select: { id: true } }));
  if (!selection || !demande) {
    return NextResponse.json({ error: "Sélection introuvable." }, { status: 404 });
  }

  const interviews = await prisma.interview.findMany({
    where: { candidateSelectionId: params.selectionId },
    include: { participants: { select: { id: true, role: true, fonctionDeclaree: true, estOrganisateur: true, statutInvitation: true } } },
    orderBy: { dateHeure: "asc" },
  });

  const resultats = interviews.map(({ meetingExternalId: _meetingExternalId, ...interview }) => interview);

  return NextResponse.json({ selectionId: params.selectionId, interviews: resultats });
}
