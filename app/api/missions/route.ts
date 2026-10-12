import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculerTjmCout } from "@/lib/calculs";
import { getSession } from "@/lib/auth";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { estModeTravailValide, suggererContexteMission } from "@/lib/mission/context-bridge";
import {
  validerPinsMission,
  NeedIntrouvableError,
  SolutionDecisionIntrouvableError,
  SolutionDecisionNiveauInvalideError,
  SolutionDecisionNonFinaliseeError,
  PinsIncoherentsError,
} from "@/lib/mission/need-pinning";
import { journaliser } from "@/lib/audit";
import { CandidateProposalIntrouvableError } from "@/lib/candidate-proposal/proposal";
import {
  ChaineIdentiteCandidatRompueError,
  MissionConflitParametresError,
  PropositionNonAccepteeError,
  creerOuReprendreMissionAvecRetry,
} from "@/lib/candidate-proposal/mission";

// LOT 16.3 — MISSION LIST SCALABILITY (30/09/2026). Pagination serveur
// page/pageSize — un modèle curseur n'est pas justifié ici (pas de flux
// temps réel, pas d'insertion concurrente à haute fréquence sur cette
// liste). Bornes volontairement sûres : page/pageSize toujours normalisés
// (jamais un 400 sur un paramètre invalide, jamais un volume arbitraire
// demandable) — voir normaliserPagination() ci-dessous.
//
// Tri : `createdAt desc` existait déjà mais n'était pas structurellement
// unique (deux missions au même timestamp restaient dans un ordre non
// garanti d'une requête à l'autre) — `id asc` ajouté comme départageur
// stable, seul changement de tri de ce lot.
//
// Sécurité : le WHERE (isolation INGENIEUR sur son propre profilId, CLIENT
// bloqué en amont) est strictement identique à l'existant et s'applique
// AVANT toute pagination, à la fois pour le `count` et pour le `findMany`
// — page/pageSize ne peuvent donc jamais élargir l'ensemble de missions
// accessible, seulement en découper l'affichage. `total` est calculé avec
// exactement le même WHERE : jamais une fuite du nombre réel de missions
// hors du périmètre du rôle courant.
const PAGE_SIZE_DEFAUT = 20;
const PAGE_SIZE_MAX = 100;

function normaliserPagination(searchParams: URLSearchParams): { page: number; pageSize: number } {
  const pageBrut = Number(searchParams.get("page"));
  const page = Number.isInteger(pageBrut) && pageBrut >= 1 ? pageBrut : 1;

  const pageSizeBrut = Number(searchParams.get("pageSize"));
  const pageSize = Number.isInteger(pageSizeBrut) && pageSizeBrut >= 1 ? Math.min(pageSizeBrut, PAGE_SIZE_MAX) : PAGE_SIZE_DEFAUT;

  return { page, pageSize };
}

// FIX B17 (08/09/2026) — GET/POST prennent désormais `req: NextRequest`
// (au lieu de `()` / déjà présent pour POST) pour pouvoir journaliser
// l'IP sur un refus RBAC. Les contrôles de rôle ci-dessous existaient déjà
// avant B17 ; seule la journalisation est nouvelle — voir middleware.ts
// (FIX B17) pour l'explication de la faille de traçabilité corrigée
// (ces contrôles étaient inatteignables pour CLIENT car bloqué en amont
// par le middleware, donc jamais journalisés jusqu'ici).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (session.role === "CLIENT") {
    // le client a son propre endpoint filtré : /api/client/missions
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions",
      acteurEmail: session.email,
      acteurRole: session.role,
      ressourceType: "Mission",
      detail: "Tentative d'accès à la liste complète des missions par un rôle Client (endpoint réservé Admin/Ingénieur, voir /api/client/missions).",
    });
    return NextResponse.json({ error: "Utilisez /api/client/missions" }, { status: 403 });
  }

  const { page, pageSize } = normaliserPagination(req.nextUrl.searchParams);
  // INGENIEUR : uniquement les missions liées à son propre profil — même
  // WHERE utilisé pour le compte total ET pour la page demandée, jamais
  // deux critères divergents.
  const where = session.role === "INGENIEUR" && session.profilId ? { profilId: session.profilId } : {};

  const [total, missions] = await Promise.all([
    prisma.mission.count({ where }),
    prisma.mission.findMany({
      where,
      // LOT 6 : sourceDemande en lecture minimale (id + titre uniquement) —
      // jamais les critères internes de la demande, qui restent consultables
      // exclusivement via /admin/talent/[id] (déjà réservé Admin).
      include: { client: true, profil: true, sourceDemande: { select: { id: true, titre: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const hyp = await prisma.hypotheses.upsert({ where: { id: "singleton" }, update: {}, create: {} });

  const enrichies = missions.map((m) => {
    // INGENIEUR : ne voit ni tarifs, ni marges, ni coûts — seulement le
    // déroulé opérationnel de sa propre mission (LOT 6 : dateDebut/dateFin/
    // modeTravail en font partie ; sourceDemande reste Admin-only).
    if (session.role === "INGENIEUR") {
      return {
        id: m.id,
        repere: m.repere,
        nbJours: m.nbJours,
        statut: m.statut,
        dateDebut: m.dateDebut,
        dateFin: m.dateFin,
        modeTravail: m.modeTravail,
        client: { nom: m.client.nom },
      };
    }

    // ADMIN : accès complet
    const tjmCout = calculerTjmCout(m.profil.type, m.profil.montantSaisi, hyp);
    const tjmCoutOverhead = tjmCout != null ? tjmCout * (1 + hyp.overhead) : null;
    const ca = m.tjmVente * m.nbJours;
    const coutTotal = tjmCoutOverhead != null ? tjmCoutOverhead * m.nbJours : null;
    const margeEuros = coutTotal != null ? ca - coutTotal : null;
    const margePct = margeEuros != null && ca > 0 ? margeEuros / ca : null;
    return { ...m, tjmCout, tjmCoutOverhead, ca, coutTotal, margeEuros, margePct };
  });

  return NextResponse.json({
    items: enrichies,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

// Devises acceptées pour deviseVente — mêmes codes que TAUX_REPLI dans
// lib/taux-change.ts, pour rester cohérent avec le reste de la plateforme.
const DEVISES_ACCEPTEES = ["EUR", "USD", "GBP", "CHF", "MAD", "TND", "DZD", "AED", "SAR", "QAR", "CAD"];

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/missions",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Mission",
      detail: "Tentative de création de mission par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const body = await req.json();

  // ATLAS CANDIDATE PROPOSAL (A35.8) — voir
  // docs/architecture/CANDIDATE_PROPOSAL_IMPLEMENTATION_CONTRACT.md §7.2/§10.8
  // (LOCKED A35/A35.1, corrigé A35.4/A35.6, audité A35.7 PASS). Extension du
  // body existant avec un champ optionnel candidateProposalId — jamais une
  // nouvelle route de création de Mission (même discipline que
  // sourceDemandeId, LOT 6). Chemin entièrement séparé et antérieur au
  // comportement existant ci-dessous : un appelant qui n'utilise pas ce
  // champ n'entre jamais dans cette branche, zéro changement de
  // comportement pour lui (invariant §14 critère 3 du contrat).
  //
  // A36.6 (décision A36.5) — "profilId" n'est plus lu du corps pour cette
  // branche : il est résolu exclusivement côté serveur depuis la chaîne de
  // relations CandidateProposal -> ... -> ShortlistEntree.profilId (voir
  // lib/candidate-proposal/mission.ts). Un appelant qui envoie encore ce
  // champ n'a plus aucun effet sur l'identité du Profil retenu.
  const candidateProposalId = typeof body.candidateProposalId === "string" && body.candidateProposalId.trim().length > 0 ? body.candidateProposalId : null;
  if (candidateProposalId) {
    // needVersionId/solutionDecisionId restent toujours null pour cette
    // chaîne (invariant 17, D3 LOCKED) — jamais une correction silencieuse
    // d'une valeur explicitement fournie par l'appelant, refus explicite.
    if (body.needVersionId || body.solutionDecisionId) {
      return NextResponse.json(
        { error: "needVersionId/solutionDecisionId sont incompatibles avec candidateProposalId (toujours null pour cette chaîne)." },
        { status: 400 }
      );
    }

    // clientId toujours dérivé de la CandidateProposal côté serveur —
    // jamais du corps de la requête (même discipline que sourceDemandeId).
    const proposition = await prisma.candidateProposal.findUnique({ where: { id: candidateProposalId }, select: { clientId: true } });
    if (!proposition) {
      return NextResponse.json({ error: "CandidateProposal introuvable." }, { status: 404 });
    }
    const clientIdDerive = proposition.clientId;

    if (!clientIdDerive || !body.nbJours || !body.tjmVente) {
      return NextResponse.json({ error: "nbJours et tjmVente sont requis" }, { status: 400 });
    }

    const deviseDemandeeCP = typeof body.deviseVente === "string" ? body.deviseVente.trim().toUpperCase() : "";
    const deviseVenteCP = DEVISES_ACCEPTEES.includes(deviseDemandeeCP) ? deviseDemandeeCP : "EUR";

    let dateDebutCP: Date | null = null;
    if (body.dateDebut !== undefined && body.dateDebut !== null) {
      const parsed = new Date(body.dateDebut);
      if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: "dateDebut invalide" }, { status: 400 });
      dateDebutCP = parsed;
    }
    let dateFinCP: Date | null = null;
    if (body.dateFin !== undefined && body.dateFin !== null) {
      const parsed = new Date(body.dateFin);
      if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: "dateFin invalide" }, { status: 400 });
      dateFinCP = parsed;
    }
    let modeTravailCP: string | null = null;
    if (body.modeTravail !== undefined && body.modeTravail !== null) {
      if (!estModeTravailValide(body.modeTravail)) {
        return NextResponse.json({ error: "modeTravail invalide (Remote, Hybride ou Sur site)" }, { status: 400 });
      }
      modeTravailCP = body.modeTravail;
    }

    try {
      const { mission, mutationReelle } = await creerOuReprendreMissionAvecRetry({
        candidateProposalId,
        nbJours: body.nbJours,
        tjmVente: body.tjmVente,
        deviseVente: deviseVenteCP,
        repere: body.repere ?? null,
        margeCible: body.margeCible ?? 0.3,
        dateDebut: dateDebutCP,
        dateFin: dateFinCP,
        modeTravail: modeTravailCP,
      });

      // §7.2 étape 3bis — uniquement pour la branche de création réelle,
      // jamais pour une reprise idempotente (corrigé A35.4/F7).
      if (mutationReelle) {
        await journaliser({
          acteurEmail: session.email,
          acteurRole: "ADMIN",
          action: "candidate.proposal.mission_created",
          cible: `proposal:${candidateProposalId} mission:${mission.id}`,
        });
      }

      return NextResponse.json(mission, { status: mutationReelle ? 201 : 200 });
    } catch (erreur) {
      if (erreur instanceof CandidateProposalIntrouvableError) {
        return NextResponse.json({ error: "CandidateProposal introuvable." }, { status: 404 });
      }
      if (erreur instanceof PropositionNonAccepteeError) {
        return NextResponse.json({ error: "CandidateProposal non acceptée (ACCEPTEE requis)." }, { status: 400 });
      }
      if (erreur instanceof MissionConflitParametresError) {
        return NextResponse.json({ error: "Une Mission existe déjà pour cette proposition avec des paramètres différents." }, { status: 409 });
      }
      if (erreur instanceof ChaineIdentiteCandidatRompueError) {
        // A36.6 — ne devrait structurellement jamais se produire (chaîne de
        // FK onDelete:Restrict, voir A36.5) : signalé comme une erreur
        // serveur explicite, jamais masqué ni fabriqué comme un succès.
        return NextResponse.json({ error: "Impossible de déterminer l'ingénieur associé à cette proposition." }, { status: 500 });
      }
      throw erreur;
    }
  }

  // LOT 6 — Mission Context Bridge (16/09/2026) : lorsqu'une sourceDemandeId
  // est fournie, clientId est TOUJOURS dérivé de la DemandeTalent côté
  // serveur — jamais du corps de la requête, même s'il en contient un
  // (silencieusement ignoré). C'est la même discipline que LOT 5
  // (ClientNeed -> DemandeTalent) : un clientId dérivable côté serveur
  // n'est jamais accepté depuis le body (empêche structurellement tout
  // rattachement d'une Mission au mauvais client).
  let clientId: string = body.clientId;
  let contexteSuggere: { dateDebut: Date | null; modeTravail: string | null } = { dateDebut: null, modeTravail: null };
  const sourceDemandeId = typeof body.sourceDemandeId === "string" && body.sourceDemandeId.trim().length > 0 ? body.sourceDemandeId : null;

  if (sourceDemandeId) {
    const demande = await prisma.demandeTalent.findUnique({
      where: { id: sourceDemandeId },
      select: { clientId: true, dateDebutSouhaitee: true, mobilite: true },
    });
    if (!demande) {
      return NextResponse.json({ error: "Demande Talent introuvable" }, { status: 404 });
    }
    clientId = demande.clientId;
    contexteSuggere = suggererContexteMission(demande);
  }

  if (!clientId || !body.profilId || !body.nbJours || !body.tjmVente) {
    return NextResponse.json(
      { error: "clientId, profilId, nbJours et tjmVente sont requis" },
      { status: 400 }
    );
  }

  // deviseVente optionnel — défaut EUR (même comportement qu'avant l'ajout
  // du champ, voir prisma/schema.prisma) si absent ou non reconnu.
  const deviseDemandee = typeof body.deviseVente === "string" ? body.deviseVente.trim().toUpperCase() : "";
  const deviseVente = DEVISES_ACCEPTEES.includes(deviseDemandee) ? deviseDemandee : "EUR";

  // LOT 6 : dateDebut/dateFin/modeTravail toujours explicitement fournis
  // par l'Admin l'emportent sur la suggestion dérivée de la demande —
  // jamais l'inverse (la suggestion n'est qu'un pré-remplissage, jamais
  // une valeur imposée). Une date fournie mais invalide est un refus
  // explicite (400), jamais silencieusement ignorée ou devinée.
  let dateDebut = contexteSuggere.dateDebut;
  if (body.dateDebut !== undefined) {
    if (body.dateDebut === null) {
      dateDebut = null;
    } else {
      const parsed = new Date(body.dateDebut);
      if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: "dateDebut invalide" }, { status: 400 });
      dateDebut = parsed;
    }
  }
  let dateFin: Date | null = null;
  if (body.dateFin !== undefined && body.dateFin !== null) {
    const parsed = new Date(body.dateFin);
    if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: "dateFin invalide" }, { status: 400 });
    dateFin = parsed;
  }
  let modeTravail: string | null = contexteSuggere.modeTravail;
  if (body.modeTravail !== undefined) {
    if (body.modeTravail === null) {
      modeTravail = null;
    } else if (!estModeTravailValide(body.modeTravail)) {
      return NextResponse.json({ error: "modeTravail invalide (Remote, Hybride ou Sur site)" }, { status: 400 });
    } else {
      modeTravail = body.modeTravail;
    }
  }

  // A18 — Mission Need Pinning + Solution Decision (05/10/2026). Optionnels,
  // immuables une fois posés (aucune route ne mute ces champs après
  // création — voir app/api/missions/[id]/transition/route.ts, seule autre
  // écriture sur Mission, qui ne touche que `statut`). Toute incohérence
  // (Need/Décision introuvable, mauvais tenant, décision pas de niveau
  // DECISION, décision non finalisée, décision rattachée à un autre Need
  // que needVersionId) est un refus explicite — jamais une correction
  // silencieuse vers le Need courant (contrat A13).
  let pins;
  try {
    pins = await validerPinsMission(prisma, {
      clientId,
      needVersionId: typeof body.needVersionId === "string" ? body.needVersionId : null,
      solutionDecisionId: typeof body.solutionDecisionId === "string" ? body.solutionDecisionId : null,
    });
  } catch (erreur) {
    if (erreur instanceof NeedIntrouvableError) {
      return NextResponse.json({ error: "Need introuvable" }, { status: 404 });
    }
    if (erreur instanceof SolutionDecisionIntrouvableError) {
      return NextResponse.json({ error: "SolutionDecision introuvable" }, { status: 404 });
    }
    if (erreur instanceof SolutionDecisionNiveauInvalideError) {
      return NextResponse.json({ error: "La SolutionOption référencée n'est pas de niveau DECISION" }, { status: 400 });
    }
    if (erreur instanceof SolutionDecisionNonFinaliseeError) {
      return NextResponse.json({ error: "La SolutionDecision référencée n'est pas finalisée (decideParEmail/decideLe manquants)" }, { status: 400 });
    }
    if (erreur instanceof PinsIncoherentsError) {
      return NextResponse.json({ error: "solutionDecisionId ne correspond pas au Need référencé par needVersionId" }, { status: 400 });
    }
    throw erreur;
  }

  const mission = await prisma.mission.create({
    data: {
      clientId,
      profilId: body.profilId,
      repere: body.repere ?? null,
      nbJours: body.nbJours,
      margeCible: body.margeCible ?? 0.3,
      tjmVente: body.tjmVente,
      deviseVente,
      sourceDemandeId,
      dateDebut,
      dateFin,
      modeTravail,
      needVersionId: pins.needVersionId,
      solutionDecisionId: pins.solutionDecisionId,
    },
  });
  return NextResponse.json(mission, { status: 201 });
}
