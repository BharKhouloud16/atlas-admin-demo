import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { ClientNeedStatut, NeedLifecycleStatut } from "@prisma/client";

// COMPANY ATLAS — LOT 2 : Client Need Intelligence Foundation (15/09/2026).
//
// Même discipline d'isolation que le reste de l'Espace Client : l'id de
// l'URL sélectionne UNIQUEMENT quel enregistrement lire/modifier/supprimer
// — jamais quel client. Chaque opération revérifie explicitement
// `besoin.clientId === session.clientId` avant d'agir ; un besoin
// appartenant à un autre client renvoie 404, jamais une fuite d'existence
// (même principe que /api/evaluations, /api/feuilles-de-temps).
//
// PATCH est volontairement limité à `titre`/`statut` (métadonnées du
// besoin) — la correction/validation des FAITS individuels (INFERE ->
// VERIFIE, correction de valeur) est explicitement HORS PÉRIMÈTRE de ce
// lot (directive CEO, autorisation d'implémentation LOT 2).

// A_CLARIFIER volontairement absent : ce statut est exclusivement piloté
// par le serveur (lib/client-need/clarification.ts, LOT 3) — le client ne
// doit jamais pouvoir le forcer directement (décision CEO LOT 3).
const STATUTS_MODIFIABLES_PAR_CLIENT = new Set(["SOUMIS", "VALIDE", "ARCHIVE"]);

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const besoin = await prisma.clientNeed.findUnique({
    where: { id: params.id },
    include: { faits: true },
  });
  if (!besoin || besoin.clientId !== session.clientId) {
    return NextResponse.json({ error: "Besoin introuvable." }, { status: 404 });
  }

  return NextResponse.json({ besoin });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const besoin = await prisma.clientNeed.findUnique({ where: { id: params.id } });
  if (!besoin || besoin.clientId !== session.clientId) {
    return NextResponse.json({ error: "Besoin introuvable." }, { status: 404 });
  }

  // LOT A — ATLAS FUNCTIONAL SPECIFICATION vFINAL (30/09/2026) — STOP
  // documenté (gate "LOT A — IMPLEMENTATION", règle absolue §1) : une
  // modification de `titre` sur un besoin déjà VALIDATED devrait, selon A5,
  // créer une nouvelle version de ClientNeed plutôt qu'une écriture en
  // place. Le Design Freeze A0 (§7/§9) verrouille la mécanique de
  // chaînage des VERSIONS de ClientNeed (version/needParentId/
  // needSuivantId, déjà ajoutés au schéma dans ce lot) mais NE SPÉCIFIE PAS
  // le comportement des ClientNeedFait existants lors du basculement
  // (copiés vers la nouvelle version, ou résolus par remontée de la chaîne
  // needParentId) — une décision d'architecture réelle (duplication de
  // données vs. lecture chaînée), pas une règle métier déjà tranchée.
  // Conformément à la règle absolue #1 de ce lot ("stoppe l'implémentation
  // de la partie concernée ; documente précisément le conflit ; ne prends
  // pas de décision métier implicite"), le déclenchement RÉEL du
  // versioning (fork de ClientNeed) N'EST PAS implémenté dans cette route
  // — seul le mapping lifecycleStatut trivial (VALIDE->VALIDATED,
  // ARCHIVE->ARCHIVED) l'est. Une modification de `titre` sur un besoin
  // VALIDATED reste donc, dans ce lot, une écriture en place comme avant —
  // non-conforme à l'intention finale d'A5, volontairement non résolu
  // plutôt que deviné. Voir rapport final, section "Points STOP".
  const body = await req.json().catch(() => null);
  const data: { titre?: string | null; statut?: ClientNeedStatut; lifecycleStatut?: NeedLifecycleStatut } = {};

  if (body?.titre !== undefined) {
    if (body.titre !== null && (typeof body.titre !== "string" || body.titre.trim().length === 0)) {
      return NextResponse.json({ error: "titre invalide." }, { status: 400 });
    }
    data.titre = body.titre === null ? null : body.titre.trim().slice(0, 200);
  }

  if (body?.statut !== undefined) {
    if (typeof body.statut !== "string" || !STATUTS_MODIFIABLES_PAR_CLIENT.has(body.statut)) {
      return NextResponse.json(
        { error: "statut invalide. BROUILLON et A_CLARIFIER ne sont jamais modifiables directement par le client." },
        { status: 400 }
      );
    }
    data.statut = body.statut as ClientNeedStatut;
    // Mapping trivial verrouillé par le gate A0 §2. Le cas SOUMIS (le
    // client peut re-soumettre un besoin VALIDE, comportement préexistant
    // inchangé par ce lot) est un point d'ambiguïté distinct, également
    // documenté : déterminer UNDERSTANDING vs STRUCTURING exigerait de
    // relire les faits et `coherenceDetail` ici (logique aujourd'hui
    // uniquement présente dans [id]/faits/route.ts) — non implémenté,
    // `lifecycleStatut` reste donc inchangé dans ce cas précis plutôt que
    // deviné.
    if (data.statut === "VALIDE") data.lifecycleStatut = "VALIDATED";
    if (data.statut === "ARCHIVE") data.lifecycleStatut = "ARCHIVED";
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Aucune modification fournie." }, { status: 400 });
  }

  const misAJour = await prisma.clientNeed.update({
    where: { id: params.id },
    data,
    include: { faits: true },
  });

  return NextResponse.json({ besoin: misAJour });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const besoin = await prisma.clientNeed.findUnique({ where: { id: params.id } });
  if (!besoin || besoin.clientId !== session.clientId) {
    return NextResponse.json({ error: "Besoin introuvable." }, { status: 404 });
  }

  // onDelete: Cascade (ClientNeedFait -> ClientNeed) — les faits associés
  // sont supprimés avec le besoin, aucune ligne orpheline.
  await prisma.clientNeed.delete({ where: { id: params.id } });

  return NextResponse.json({ ok: true });
}
