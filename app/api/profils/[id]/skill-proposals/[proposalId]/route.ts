import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { missionSkillProposalDecisionSchema, premierMessageZod } from "@/lib/validation";
import { creerPreuveCompetence } from "@/lib/talent/skill-evidence-service";

// ATLAS — PHASE 2B-1 : MISSION SKILL PROPOSAL — validation / refus (mandat
// section 7/8). SEULE route capable de transformer une MissionSkillProposal
// en SkillEvidence réelle — réservée Admin, exactement comme 100% du reste
// des routes de décision du Skill Graph (PATCH .../competences/[id], POST
// .../competences/[id]/preuves).
//
// TRANSACTION CRITIQUE (mandat section 8) : verrouille la proposition
// (SELECT ... FOR UPDATE, même idiome que lib/strategic/
// authorization-request.ts, adapté ici — pas copié tel quel : cette
// transaction ne gère qu'un verrou simple + une garde de statut, pas de
// compensation multi-étapes), vérifie EN_ATTENTE, crée la SkillEvidence
// (validation) OU ne crée RIEN (refus), fait transiter la proposition —
// tout ou rien. Il ne doit jamais être possible d'avoir une proposition
// VALIDEE sans SkillEvidence, ni l'inverse.
type PropositionVerrouillee = {
  id: string;
  missionId: string;
  profilId: string;
  competence: string;
  statut: "EN_ATTENTE" | "VALIDEE" | "REFUSEE";
};

type ResultatDecision =
  | { ok: false; code: 404 | 409; erreur: string }
  | { ok: true; action: "refuser"; proposition: { id: string; missionId: string; profilId: string; competence: string } & Record<string, unknown> }
  | {
      ok: true;
      action: "valider";
      proposition: { id: string; missionId: string; profilId: string; competence: string } & Record<string, unknown>;
      skillEvidenceId: string;
    };

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; proposalId: string } }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const profil = await prisma.profil.findUnique({ where: { id: params.id } });
  if (!profil) {
    return NextResponse.json({ error: "Profil introuvable" }, { status: 404 });
  }

  const corps = await req.json().catch(() => ({}));
  const analyse = missionSkillProposalDecisionSchema.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ error: premierMessageZod(analyse.error) }, { status: 400 });
  }
  const donnees = analyse.data;

  const resultat: ResultatDecision = await prisma.$transaction(async (tx) => {
    const lignes = await tx.$queryRaw<PropositionVerrouillee[]>`
      SELECT "id", "missionId", "profilId", "competence", "statut"
      FROM "MissionSkillProposal"
      WHERE "id" = ${params.proposalId}
      FOR UPDATE
    `;
    const proposition = lignes[0];
    // Jamais 403 : IDOR — une proposition d'un autre profil que l'URL
    // n'existe structurellement pas "pour ce profil", même politique que
    // le reste du Skill Graph.
    if (!proposition || proposition.profilId !== params.id) {
      return { ok: false, code: 404, erreur: "Proposition introuvable" };
    }
    if (proposition.statut !== "EN_ATTENTE") {
      return { ok: false, code: 409, erreur: `Proposition déjà décidée (${proposition.statut}).` };
    }

    if (donnees.action === "refuser") {
      // Le refus ne crée AUCUNE SkillEvidence — la proposition est
      // conservée telle quelle (jamais supprimée), simplement marquée
      // REFUSEE. Une nouvelle proposition ultérieure pour la même
      // compétence créera une ligne indépendante (D2/mandat section 9) —
      // celle-ci n'est jamais rouverte.
      const apres = await tx.missionSkillProposal.update({
        where: { id: proposition.id },
        data: { statut: "REFUSEE", decidePar: session.email, decideLe: new Date(), motifRefus: donnees.motif ?? null },
      });
      return { ok: true, action: "refuser", proposition: apres };
    }

    // action === "valider" — la compétence peut ne pas encore exister sur
    // ce profil (première mention) : créée ici avec l'état neutre
    // INCONNU/BASSE, exactement comme le ferait un upsert manuel (même
    // état par défaut que le schéma Prisma) — creerPreuveCompetence()
    // s'occupe ensuite de la faire évoluer via fusionnerCompetence, sans
    // jamais fabriquer un niveau ou un statut non fourni.
    let existante = await tx.profilCompetence.findUnique({
      where: { profilId_competence: { profilId: proposition.profilId, competence: proposition.competence } },
    });
    if (!existante) {
      existante = await tx.profilCompetence.create({
        data: { profilId: proposition.profilId, competence: proposition.competence, statut: "INCONNU", confiance: "BASSE" },
      });
    }

    const mission = await tx.mission.findUnique({ where: { id: proposition.missionId }, select: { id: true, repere: true } });
    const referenceMission = mission?.repere ? `Mission ${mission.repere}` : `Mission ${proposition.missionId}`;
    const detailPreuve = [
      `${referenceMission} — proposition validée par ${session.email}`,
      donnees.motif ? `(${donnees.motif})` : null,
    ]
      .filter(Boolean)
      .join(" ");

    // Réutilise TEL QUEL le cœur de création déjà utilisé par POST
    // .../competences/[competenceId]/preuves (mandat section 10 : "ne
    // duplique pas la logique de création des preuves"). statutPropose:
    // "DECLARE" — une MissionSkillProposal validée par un Admin est au
    // moins équivalente à une déclaration (Profil.competences, voir
    // construireCompetencesDeclarees) : sans cela, une compétence encore
    // inconnue resterait INCONNU malgré une preuve MISSION attachée, et
    // n'entrerait jamais dans versCompetencesPourMatching() — le pont vers
    // l'Intelligence/Matching visé par ce mandat resterait sans effet.
    // fusionnerCompetence() garantit que ceci ne régresse JAMAIS un statut
    // déjà plus fort (VERIFIE reste acquis) et ne peut jamais, par cette
    // voie, atteindre VERIFIE — seule la route PATCH .../competences/[id]
    // dédiée le peut. Signalé explicitement dans le rapport final comme
    // décision d'implémentation (mandat section 22).
    const resultatPreuve = await creerPreuveCompetence(tx, existante, {
      source: "MISSION",
      detail: detailPreuve,
      niveauObserve: donnees.niveauObserve ?? null,
      statutPropose: "DECLARE",
    });

    const apres = await tx.missionSkillProposal.update({
      where: { id: proposition.id },
      data: {
        statut: "VALIDEE",
        decidePar: session.email,
        decideLe: new Date(),
        skillEvidenceId: resultatPreuve.skillEvidenceCreee.id,
      },
    });

    return { ok: true, action: "valider", proposition: apres, skillEvidenceId: resultatPreuve.skillEvidenceCreee.id };
  });

  if (!resultat.ok) {
    return NextResponse.json({ error: resultat.erreur }, { status: resultat.code });
  }

  if (resultat.action === "valider") {
    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "mission.skill_proposal.validated",
      cible: `proposal:${resultat.proposition.id}`,
      detail: `Mission ${resultat.proposition.missionId}, profil ${params.id}, compétence ${resultat.proposition.competence} : proposition validée -> SkillEvidence ${resultat.skillEvidenceId} (niveau validé : ${donnees.niveauObserve ?? "non renseigné"}).`,
    });
  } else {
    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "mission.skill_proposal.rejected",
      cible: `proposal:${resultat.proposition.id}`,
      detail: `Mission ${resultat.proposition.missionId}, profil ${params.id}, compétence ${resultat.proposition.competence} : proposition refusée${donnees.motif ? ` (motif : ${donnees.motif})` : ""}.`,
    });
  }

  return NextResponse.json(resultat.proposition);
}
