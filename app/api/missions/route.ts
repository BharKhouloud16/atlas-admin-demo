import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculerTjmCout } from "@/lib/calculs";
import { getSession } from "@/lib/auth";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { estModeTravailValide, suggererContexteMission } from "@/lib/mission/context-bridge";

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

  const missions = await prisma.mission.findMany({
    // INGENIEUR : uniquement les missions liées à son propre profil
    where: session.role === "INGENIEUR" && session.profilId ? { profilId: session.profilId } : {},
    // LOT 6 : sourceDemande en lecture minimale (id + titre uniquement) —
    // jamais les critères internes de la demande, qui restent consultables
    // exclusivement via /admin/talent/[id] (déjà réservé Admin).
    include: { client: true, profil: true, sourceDemande: { select: { id: true, titre: true } } },
    orderBy: { createdAt: "desc" },
  });

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

  return NextResponse.json(enrichies);
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
    },
  });
  return NextResponse.json(mission, { status: 201 });
}
