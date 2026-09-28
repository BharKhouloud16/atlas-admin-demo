import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";

// ATLAS — MISSION LIFECYCLE V1 (Phase 2B-0, 28/09/2026).
//
// Transition de statut contrôlée pour Mission — même convention que
// app/api/factures/[id]/transition/route.ts : une whitelist stricte
// d'actions, jamais une écriture arbitraire de `statut` depuis le body.
// Mission.statut reste un String (voir lib/billing/etat-facture.ts pour le
// précédent enum + transitionAutorisee() — délibérément pas repris ici :
// l'audit Phase 2B-0 a conclu que ce n'est pas nécessaire pour débloquer le
// lifecycle, seulement une route disciplinée l'est).
//
// Avant ce lot, AUCUNE route ne faisait jamais transiter Mission.statut
// après sa création (`"En cours"` par défaut, jamais réécrit) — confirmé
// par audit exhaustif (`grep prisma.mission.update` = 0 résultat hors
// tests). Conséquence directe : Talent Trust.historiqueMissions,
// Talent Intelligence.missionsTerminees et POST /api/evaluations (qui
// exige mission.statut === "Terminée") étaient structurellement
// inatteignables en usage réel. Cette route ne change RIEN à leur logique
// (aucune ligne de lib/talent/* ni de app/api/evaluations/route.ts
// modifiée) — elle rend seulement la donnée qu'ils lisent déjà réellement
// productible.
//
// "Terminée" et "Annulée" sont volontairement TERMINAUX pour ce lot :
// aucune transition sortante n'est autorisée depuis l'un ou l'autre (pas de
// réouverture, pas de passage direct Terminée<->Annulée) — voir mandat
// Phase 2B-0, section 1. Réservé Admin, jamais l'Ingénieur (même sur sa
// propre mission) ni le Client — même principe que toutes les autres
// transitions administratives de ce repository (CRA, Facture, Skill Graph).
//
// RÈGLE ABSOLUE (Phase 2B-0, section 13) : une Mission terminée n'est PAS
// une preuve de compétence. Cette route ne touche jamais SkillEvidence,
// ProfilCompetence, ni aucun calcul de lib/talent/* — le futur workflow
// MissionSkillProposal -> SkillEvidence (Phase 2B-1+) en est entièrement
// indépendant.
const TRANSITIONS_AUTORISEES: Record<string, string> = {
  terminer: "Terminée",
  annuler: "Annulée",
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const nouveauStatut = typeof action === "string" ? TRANSITIONS_AUTORISEES[action] : undefined;
  if (!nouveauStatut) {
    return NextResponse.json({ error: "Action invalide (terminer ou annuler attendu)." }, { status: 400 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: params.id } });
  if (!mission) {
    return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });
  }

  // Seule transition autorisée dans ce lot : depuis "En cours". Terminée et
  // Annulée sont des états terminaux, sans transition sortante — un état
  // déjà terminal est donc refusé ici avant toute écriture (aucune mutation
  // partielle possible).
  if (mission.statut !== "En cours") {
    return NextResponse.json(
      { error: `Transition impossible depuis le statut actuel (${mission.statut}).` },
      { status: 409 }
    );
  }

  const avant = mission.statut;
  const apres = await prisma.mission.update({
    where: { id: params.id },
    data: { statut: nouveauStatut },
  });

  await journaliser({
    acteurEmail: session.email,
    acteurRole: "ADMIN",
    action: action === "terminer" ? "mission.terminee" : "mission.annulee",
    cible: `mission:${params.id}`,
    detail: `Mission ${params.id} (client ${mission.clientId}, profil ${mission.profilId}) : statut ${avant} -> ${apres.statut}`,
  });

  return NextResponse.json(apres);
}
