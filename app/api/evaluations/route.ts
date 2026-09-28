import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { envoyerEmailNouvelleEvaluation } from "@/lib/email";
import { evaluationSchema, premierMessageZod } from "@/lib/validation";

// Évaluations client des missions terminées — voir prisma/schema.prisma
// (Evaluation, 1 par mission) et app/client/page.tsx. Alimente les
// statistiques personnelles de l'ingénieur (voir /api/ingenieur/profil) et,
// à titre informatif, le tableau Admin (/admin/profils) — n'entre pas dans
// le calcul du score (lib/scoring.ts) pour ne pas pénaliser les profils
// sans historique de mission.
//
// EVALUATION API HARDENING (voir audit "Evaluation API Hardening & Test
// Audit") : le contrat métier de POST reste STRICTEMENT identique (mêmes
// champs acceptés, mêmes règles RBAC/ownership/statut, même sens des
// réponses 400/404/409) — seule la ROBUSTESSE change (plus de 500 non
// maîtrisé sur un body malformé, un missionId mal typé, ou une race
// condition sur double-POST concurrent).
//
// IMMUTABILITÉ — décision explicite de ce lot (pas seulement une lacune) :
// une Evaluation, une fois créée, n'est ni modifiable ni supprimable —
// aucune route PATCH/DELETE n'existe intentionnellement ici. La correction/
// modération d'une évaluation erronée reste un sujet produit distinct,
// volontairement hors périmètre (voir rapport final du lot).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (session.role === "CLIENT") {
    if (!session.clientId) return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    const missions = await prisma.mission.findMany({
      where: { clientId: session.clientId, statut: "Terminée" },
      select: {
        id: true,
        repere: true,
        profil: { select: { nom: true } },
        evaluation: { select: { note: true, commentaire: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ missions });
  }

  if (session.role === "ADMIN") {
    const evaluations = await prisma.evaluation.findMany({
      include: { mission: { include: { client: true, profil: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ evaluations });
  }

  return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  // Body JSON malformé/absent -> {} plutôt qu'une exception non capturée
  // (même pattern que app/api/missions/[id]/transition/route.ts) : le
  // schéma Zod ci-dessous rejette alors {} avec un 400 propre (missionId
  // requis), jamais un 500 générique.
  const corps = await req.json().catch(() => ({}));
  const analyse = evaluationSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const { missionId, note: noteNombre, commentaire } = analyse.data;

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!mission || mission.clientId !== session.clientId) {
    return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });
  }
  if (mission.statut !== "Terminée") {
    return NextResponse.json({ error: "Seule une mission terminée peut être évaluée." }, { status: 400 });
  }

  // Garde applicative — donne un message métier propre dans le cas
  // séquentiel (l'immense majorité des cas réels), mais NE PROTÈGE PAS À
  // ELLE SEULE contre une race condition : voir la contrainte @unique sur
  // Evaluation.missionId (prisma/schema.prisma) et la capture P2002
  // ci-dessous, seule protection réelle en cas de double-POST concurrent.
  const existante = await prisma.evaluation.findUnique({ where: { missionId } });
  if (existante) {
    return NextResponse.json({ error: "Cette mission a déjà été évaluée." }, { status: 409 });
  }

  let evaluation;
  try {
    evaluation = await prisma.evaluation.create({
      data: { missionId, note: noteNombre, commentaire },
    });
  } catch (e) {
    // P2002 = violation de la contrainte @unique(missionId) — seul cas
    // réel où ce catch se déclenche : une seconde requête a créé son
    // Evaluation entre le findUnique ci-dessus et ce create (race
    // condition sur double-POST concurrent, voir audit §6/§7). Même sens
    // métier que le refus séquentiel ci-dessus, jamais un 500 non maîtrisé.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "Cette mission a déjà été évaluée." }, { status: 409 });
    }
    throw e;
  }

  const compteIngenieur = await prisma.user.findUnique({
    where: { profilId: mission.profilId },
    include: { profil: true },
  });
  if (compteIngenieur) {
    await envoyerEmailNouvelleEvaluation({
      to: compteIngenieur.email,
      nom: compteIngenieur.profil?.nom ?? "",
      mission: mission.repere ?? mission.id,
      note: noteNombre,
    });
  }

  return NextResponse.json(evaluation, { status: 201 });
}
