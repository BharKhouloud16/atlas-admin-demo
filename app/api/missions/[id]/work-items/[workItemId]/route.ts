import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  lireWorkItem,
  modifierWorkItemAvecRetry,
  executerTransitionWorkItem,
  WorkItemIntrouvableError,
  WorkItemTerminalError,
  TitreInvalideError,
  TransitionInvalideError,
  RaisonBlocageManquanteError,
  RaisonBlocageInvalideError,
  RaisonResolutionManquanteError,
  MotifManquantError,
  type ActionLifecycleWorkItem,
} from "@/lib/work-item/lifecycle";

// COMPANY ATLAS — A23 : WorkItem Foundation (05/10/2026).
//
// PATCH à double forme mutuellement exclusive, même discipline que
// app/api/missions/[id]/assignments/[assignmentId]/route.ts (A20) :
// `action` présent -> transition de lifecycle ; `action` absent ->
// modification des deux SEULS champs mutables (titre/description), jamais
// disponible une fois le WorkItem terminal (TERMINE/ANNULE). Réservé
// ADMIN — même périmètre que .../assignments et .../capability-links.
const ACTIONS_VALIDES: ActionLifecycleWorkItem[] = ["demarrer", "bloquer", "debloquer", "terminer", "annuler"];

export async function GET(_req: NextRequest, { params }: { params: { id: string; workItemId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const workItem = await lireWorkItem({ workItemId: params.workItemId, missionId: params.id });
    return NextResponse.json(workItem);
  } catch (erreur) {
    if (erreur instanceof WorkItemIntrouvableError) {
      return NextResponse.json({ error: "WorkItem introuvable" }, { status: 404 });
    }
    throw erreur;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; workItemId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/work-items/[workItemId]",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "WorkItem",
      ressourceId: params.workItemId,
      detail: "Tentative de modification d'un WorkItem par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  try {
    if (typeof body?.action === "string") {
      if (!ACTIONS_VALIDES.includes(body.action as ActionLifecycleWorkItem)) {
        return NextResponse.json(
          { error: "action invalide (demarrer, bloquer, debloquer, terminer ou annuler attendu)." },
          { status: 400 }
        );
      }

      const workItem = await executerTransitionWorkItem({
        workItemId: params.workItemId,
        missionId: params.id,
        action: body.action as ActionLifecycleWorkItem,
        raison: typeof body?.raison === "string" ? body.raison : undefined,
        raisonResolution: typeof body?.raisonResolution === "string" ? body.raisonResolution : undefined,
        motif: typeof body?.motif === "string" ? body.motif : undefined,
      });

      await journaliser({
        acteurEmail: session.email,
        acteurRole: "ADMIN",
        action: "workitem.lifecycle.transition",
        cible: `mission:${params.id}`,
        detail: `WorkItem ${workItem.id} : -> ${workItem.statut} (action "${body.action}").${
          typeof body?.raison === "string" ? ` Raison : ${body.raison}.` : ""
        }${typeof body?.raisonResolution === "string" ? ` Résolution : ${body.raisonResolution}.` : ""}${
          typeof body?.motif === "string" ? ` Motif : ${body.motif}.` : ""
        }`,
      });

      return NextResponse.json(workItem, { status: 200 });
    }

    const data: { titre?: string; description?: string | null } = {};
    if (body?.titre !== undefined) {
      if (typeof body.titre !== "string" || body.titre.trim().length === 0) {
        return NextResponse.json({ error: "titre invalide (non vide)." }, { status: 400 });
      }
      data.titre = body.titre;
    }
    if (body?.description !== undefined) {
      if (body.description !== null && typeof body.description !== "string") {
        return NextResponse.json({ error: "description doit être une chaîne ou null." }, { status: 400 });
      }
      data.description = body.description;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Aucun champ modifiable fourni (titre, description, ou action)." }, { status: 400 });
    }

    const workItem = await modifierWorkItemAvecRetry({
      workItemId: params.workItemId,
      missionId: params.id,
      ...data,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "workitem.updated",
      cible: `mission:${params.id}`,
      detail: `WorkItem ${workItem.id} : ${Object.keys(data).join(", ")} modifié(s).`,
    });

    return NextResponse.json(workItem, { status: 200 });
  } catch (erreur) {
    if (erreur instanceof WorkItemIntrouvableError) {
      return NextResponse.json({ error: "WorkItem introuvable" }, { status: 404 });
    }
    if (erreur instanceof WorkItemTerminalError) {
      return NextResponse.json({ error: "Ce WorkItem est dans un état terminal (TERMINE/ANNULE), lecture seule." }, { status: 409 });
    }
    if (erreur instanceof TitreInvalideError) {
      return NextResponse.json({ error: "titre invalide (non vide)." }, { status: 400 });
    }
    if (erreur instanceof TransitionInvalideError) {
      return NextResponse.json(
        { error: `Transition impossible depuis le statut actuel (${erreur.depuis} -> ${erreur.vers}).` },
        { status: 409 }
      );
    }
    if (erreur instanceof RaisonBlocageManquanteError) {
      // A23 — mandat §41 "Blocage/28" : 409 (conflit avec l'état requis
      // pour cette transition), volontairement distinct du choix 400 fait
      // par A22 pour la même catégorie de validation sur Mission — mandat
      // WorkItem explicite, suivi à la lettre plutôt que par analogie.
      return NextResponse.json({ error: "raison requise pour bloquer un WorkItem." }, { status: 409 });
    }
    if (erreur instanceof RaisonBlocageInvalideError) {
      return NextResponse.json({ error: "raison invalide (CLIENT_DEPENDENCY, TALENT_DEPENDENCY, TECHNICAL, ACCESS, EXTERNAL ou UNKNOWN attendu)." }, { status: 409 });
    }
    if (erreur instanceof RaisonResolutionManquanteError) {
      return NextResponse.json({ error: "raisonResolution requise pour débloquer un WorkItem." }, { status: 409 });
    }
    if (erreur instanceof MotifManquantError) {
      return NextResponse.json({ error: "motif requis pour annuler un WorkItem." }, { status: 409 });
    }
    throw erreur;
  }
}
