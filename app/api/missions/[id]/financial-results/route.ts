import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import {
  creerFinancialResultAvecRetry,
  listerFinancialResultsMission,
  MissionIntrouvableError,
  MontantInvalideError,
  ProvenanceManquanteError,
  JustificationManquanteError,
  DeviseInvalideError,
  SupersedesIntrouvableError,
  DejaSupersedeError,
} from "@/lib/financial-result/financial-result";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — A29 : Financial Result Foundation (05/10/2026).
//
// RBAC (contrat A29 §28/§29, audité — même doctrine absolue que
// lib/finance/margin-intelligence.ts, Lot 10) : ADMIN UNIQUEMENT, jamais
// l'Ingénieur (même sur sa propre Mission — conflit d'intérêt explicite,
// contrat A29 §29 : "un Engineer qui exécute une Mission ne doit pas
// pouvoir s'auto-certifier un résultat financier officiel"), jamais le
// Client (donnée strictement interne Atlas, jamais tarifaire côté
// Client). Aucun rôle Agent — une IA ne peut jamais produire directement
// un Financial Result officiel (contrat A29 §28, même limitation
// documentée que A26/A27).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/financial-results",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Mission",
      ressourceId: params.id,
      detail: "Tentative de lecture de Financial Result par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!mission) return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });

  const financialResults = await listerFinancialResultsMission(params.id);
  return NextResponse.json({ missionId: params.id, financialResults });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions/[id]/financial-results",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Mission",
      ressourceId: params.id,
      detail: "Tentative de création d'un Financial Result par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);

  try {
    const financialResult = await creerFinancialResultAvecRetry({
      missionId: params.id,
      currency: typeof body?.currency === "string" ? body.currency : undefined,
      revenueAmount: body?.revenueAmount,
      revenueProvenance: body?.revenueProvenance,
      revenueJustification: body?.revenueJustification,
      costAmount: body?.costAmount,
      costProvenance: body?.costProvenance,
      costJustification: body?.costJustification,
      supersedesId: typeof body?.supersedesId === "string" ? body.supersedesId : null,
      calculatedByEmail: session.email,
      calculatedByRole: session.role,
    });

    await journaliser({
      acteurEmail: session.email,
      acteurRole: session.role,
      action: financialResult.supersedesId ? "financial_result.superseded" : "financial_result.created",
      cible: `mission:${params.id}`,
      detail: `FinancialResult ${financialResult.id} créé (résultat ${financialResult.resultatGlobal}).${
        financialResult.supersedesId ? ` Supersède ${financialResult.supersedesId}.` : ""
      }`,
    });

    return NextResponse.json(financialResult, { status: 201 });
  } catch (erreur) {
    if (erreur instanceof MissionIntrouvableError) {
      return NextResponse.json({ error: "Mission introuvable" }, { status: 404 });
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
    if (erreur instanceof SupersedesIntrouvableError) {
      return NextResponse.json({ error: "FinancialResult à superséder introuvable" }, { status: 404 });
    }
    if (erreur instanceof DejaSupersedeError) {
      return NextResponse.json({ error: "Ce FinancialResult est déjà supersédé." }, { status: 409 });
    }
    throw erreur;
  }
}
