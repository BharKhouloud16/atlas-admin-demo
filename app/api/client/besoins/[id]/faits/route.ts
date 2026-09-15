import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { dernierFaitParCle } from "@/lib/client-need/faits";
import { CLES_CLARIFIABLES, prioriserClarifications } from "@/lib/client-need/clarification";
import { evaluerCoherenceBesoin } from "@/lib/client-need/coherence";
import type { ClientNeedFaitCle, ClientNeedStatut } from "@prisma/client";

// COMPANY ATLAS — LOT 3 : Client Need Validation & Clarification (15/09/2026).
//
// Endpoint dédié permettant au client de CONFIRMER ou de CORRIGER un fait
// existant — jamais une mutation en place (décision CEO LOT 3) : chaque
// réponse crée une NOUVELLE ClientNeedFait, l'ancienne reste en base pour
// l'audit (jamais supprimée, jamais modifiée). La "valeur actuelle" est
// recalculée à la lecture (lib/client-need/faits.ts), jamais stockée
// séparément.
//
// Même discipline d'isolation que /api/client/besoins/[id] : clientId
// exclusivement dérivé de la session, ownership revérifiée avant toute
// écriture, 404 (jamais 403) si le besoin n'existe pas ou appartient à un
// autre client — aucune fuite d'existence.
//
// Périmètre strictement limité aux clés NON RÉPÉTABLES (CLES_CLARIFIABLES) —
// toute autre clé (répétable, ou hors vocabulaire) est refusée (400).

const CLES_CLARIFIABLES_SET = new Set<string>(CLES_CLARIFIABLES);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const besoin = await prisma.clientNeed.findUnique({ where: { id: params.id }, include: { faits: true } });
  if (!besoin || besoin.clientId !== session.clientId) {
    return NextResponse.json({ error: "Besoin introuvable." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const cle = body?.cle;
  const action = body?.action;

  if (typeof cle !== "string" || !CLES_CLARIFIABLES_SET.has(cle)) {
    return NextResponse.json({ error: "Clé invalide ou hors périmètre de clarification." }, { status: 400 });
  }
  if (action !== "CONFIRMER" && action !== "CORRIGER") {
    return NextResponse.json({ error: "action doit être CONFIRMER ou CORRIGER." }, { status: 400 });
  }

  const faitsExistants = besoin.faits;
  const dernierActuel = dernierFaitParCle(faitsExistants).get(cle);

  let nouvelleValeur: string;
  let source: "client_confirmation" | "client_correction";

  if (action === "CONFIRMER") {
    if (!dernierActuel || !dernierActuel.valeur) {
      return NextResponse.json({ error: "Aucune valeur actuelle à confirmer pour cette clé." }, { status: 400 });
    }
    nouvelleValeur = dernierActuel.valeur;
    source = "client_confirmation";
  } else {
    const valeurBrute = body?.valeur;
    if (typeof valeurBrute !== "string" || valeurBrute.trim().length === 0) {
      return NextResponse.json({ error: "valeur requise pour une correction (jamais une valeur inventée)." }, { status: 400 });
    }
    nouvelleValeur = valeurBrute.trim().slice(0, 200);
    source = "client_correction";
  }

  const nouveauFait = await prisma.clientNeedFait.create({
    data: {
      needId: besoin.id,
      cle: cle as ClientNeedFaitCle,
      valeur: nouvelleValeur,
      statut: "VERIFIE",
      source,
    },
  });

  const faitsMisAJour = [...faitsExistants, nouveauFait];
  const dernierParCle = dernierFaitParCle(faitsMisAJour);

  const faitsPourCoherence = [...dernierParCle.values()]
    .filter((f) => f.statut !== "INCONNU" && f.valeur)
    .map((f) => ({ cle: f.cle, valeur: f.valeur }));
  const coherence = evaluerCoherenceBesoin(faitsPourCoherence);

  const clarificationsRestantes = prioriserClarifications(dernierParCle, coherence.detail);

  // Le serveur pilote seul la transition A_CLARIFIER (décision CEO LOT 3) —
  // jamais déclenchée par le client, et jamais appliquée à un besoin déjà
  // VALIDE/ARCHIVE/BROUILLON (le client garde le contrôle explicite de ces
  // statuts via PATCH /api/client/besoins/[id]).
  let statut: ClientNeedStatut = besoin.statut;
  if (besoin.statut === "SOUMIS" || besoin.statut === "A_CLARIFIER") {
    statut = clarificationsRestantes.length > 0 ? "A_CLARIFIER" : "SOUMIS";
  }

  const besoinMisAJour = await prisma.clientNeed.update({
    where: { id: besoin.id },
    data: {
      coherenceStatut: coherence.statut,
      coherenceDetail: coherence.detail,
      statut,
    },
    include: { faits: true },
  });

  return NextResponse.json({ besoin: besoinMisAJour }, { status: 201 });
}
