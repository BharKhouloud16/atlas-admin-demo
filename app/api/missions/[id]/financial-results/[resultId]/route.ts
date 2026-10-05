import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  lireFinancialResult,
  mettreAJourFinancialResultAvecRetry,
  finaliserFinancialResult,
  FinancialResultIntrouvableError,
  FinancialResultFinaliseeError,
  MontantInvalideError,
  ProvenanceManquanteError,
  JustificationManquanteError,
  DeviseInvalideError,
  TransitionInvalideError,
} from "@/lib/financial-result/financial-result";

// COMPANY ATLAS — A29 : Financial Result Foundation (05/10/2026).
//
// PATCH distingue deux usages, jamais confondus (même convention que
// .../quality/[qualityId]/route.ts, A27) : (1) édition de contenu
// (revenue/cost/currency) — uniquement tant que DRAFT ; (2)
// `action: "finaliser"` — ADMIN uniquement (RBAC déjà garanti par le GET
// ci-dessous, aucune distinction supplémentaire par rôle : seul ADMIN
// accède jamais à cette route, contrat A29 §28/§29).
export async function GET(_req: NextRequest, { params }: { params: { id: string; resultId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  try {
    const financialResult = await lireFinancialResult(params.id, params.resultId);
    return NextResponse.json(financialResult);
  } catch (erreur) {
    if (erreur instanceof FinancialResultIntrouvableError) {
      return NextResponse.json({ error: "FinancialResult introuvable" }, { status: 404 });
    }
    throw erreur;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; resultId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/financial-results/[resultId]",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "FinancialResult",
      ressourceId: params.resultId,
      detail: "Tentative de modification d'un Financial Result par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  if (typeof body?.action === "string") {
    if (body.action !== "finaliser") {
      return NextResponse.json({ error: "action invalide (seule 'finaliser' est supportée)." }, { status: 400 });
    }
    try {
      const financialResult = await finaliserFinancialResult(params.id, params.resultId);
      await journaliser({
        acteurEmail: session.email,
        acteurRole: session.role,
        action: "financial_result.finalized",
        cible: `mission:${params.id}`,
        detail: `FinancialResult ${financialResult.id} finalisé (résultat ${financialResult.resultatGlobal}).`,
      });
      return NextResponse.json(financialResult);
    } catch (erreur) {
      if (erreur instanceof FinancialResultIntrouvableError) {
        return NextResponse.json({ error: "FinancialResult introuvable" }, { status: 404 });
      }
      if (erreur instanceof TransitionInvalideError) {
        return NextResponse.json({ error: "Ce Financial Result est déjà finalisé." }, { status: 409 });
      }
      throw erreur;
    }
  }

  try {
    const financialResult = await mettreAJourFinancialResultAvecRetry({
      missionId: params.id,
      resultId: params.resultId,
      currency: typeof body?.currency === "string" ? body.currency : undefined,
      revenueAmount: body?.revenueAmount,
      revenueProvenance: body?.revenueProvenance,
      revenueJustification: body?.revenueJustification,
      costAmount: body?.costAmount,
      costProvenance: body?.costProvenance,
      costJustification: body?.costJustification,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: session.role,
      action: "financial_result.updated",
      cible: `mission:${params.id}`,
      detail: `FinancialResult ${financialResult.id} mis à jour (résultat ${financialResult.resultatGlobal}).`,
    });

    return NextResponse.json(financialResult);
  } catch (erreur) {
    if (erreur instanceof FinancialResultIntrouvableError) {
      return NextResponse.json({ error: "FinancialResult introuvable" }, { status: 404 });
    }
    if (erreur instanceof FinancialResultFinaliseeError) {
      return NextResponse.json({ error: "Ce Financial Result est déjà finalisé, son contenu est immuable." }, { status: 409 });
    }
    if (erreur instanceof DeviseInvalideError) {
      return NextResponse.json({ error: "currency invalide." }, { status: 400 });
    }
    if (erreur instanceof MontantInvalideError) {
      return NextResponse.json({ error: `${erreur.champ}Amount invalide (nombre positif ou fini attendu).` }, { status: 400 });
    }
    if (erreur instanceof ProvenanceManquanteError) {
      return NextResponse.json({ error: `${erreur.champ}Provenance requise (DECLARE ou VERIFIE) lorsque ${erreur.champ}Amount est fourni.` }, { status: 400 });
    }
    if (erreur instanceof JustificationManquanteError) {
      return NextResponse.json({ error: `${erreur.champ}Justification requise (non vide) lorsque ${erreur.champ}Amount est fourni.` }, { status: 400 });
    }
    throw erreur;
  }
}
