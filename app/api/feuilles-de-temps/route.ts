import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { craEstEditableParIngenieur, totauxDepuisDetail, libelleMois } from "@/lib/feuilles-de-temps";
import { journaliser } from "@/lib/audit";
import { envoyerEmailCraRejete } from "@/lib/email";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";

// Feuilles de temps (CRA) : un seul endpoint, comportement différent selon
// le rôle (même approche que /api/missions) — voir lib/feuilles-de-temps.ts
// pour le circuit de statuts. L'Ingénieur crée/soumet, l'Admin valide ou
// rejette en premier, le Client valide en dernier avant facturation.
//
// FIX B17 (08/09/2026) — cette route est déjà accessible aux 3 rôles via
// SHARED_PREFIXES dans middleware.ts (pas de mort-code comme pour missions/
// clients : elle applique elle-même toute la logique RBAC + object-level
// depuis B13/B15). Contrairement à missions/clients, aucun changement de
// middleware n'était nécessaire ici — seule la journalisation des refus
// déjà émis par cette route manquait (directive B17, section 1). `GET`
// prend désormais `req: NextRequest` pour journaliser l'IP.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (session.role === "ADMIN") {
    const feuilles = await prisma.feuilleDeTemps.findMany({
      include: { mission: { include: { client: true, profil: true } } },
      orderBy: [{ statut: "asc" }, { mois: "desc" }],
    });
    return NextResponse.json({ feuilles });
  }

  if (session.role === "INGENIEUR") {
    if (!session.profilId) {
      await enregistrerEvenementSecurite({
        correlationId: nouveauCorrelationId(),
        action: "rbac.acces_refuse",
        resultat: "REFUSE",
        severite: "ATTENTION",
        contexteIp: adresseIp(req),
        contexteRoute: "/api/feuilles-de-temps",
        acteurEmail: session.email,
        acteurRole: session.role,
        ressourceType: "FeuilleDeTemps",
        detail: "Session Ingénieur sans profilId lors d'une lecture des feuilles de temps.",
      });
      return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    }
    const [missions, feuilles] = await Promise.all([
      prisma.mission.findMany({
        where: { profilId: session.profilId },
        select: { id: true, repere: true, statut: true, client: { select: { nom: true, pays: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.feuilleDeTemps.findMany({
        where: { mission: { profilId: session.profilId } },
        include: { mission: { select: { id: true, repere: true, client: { select: { nom: true } } } } },
        orderBy: { mois: "desc" },
      }),
    ]);
    return NextResponse.json({ missions, feuilles });
  }

  if (session.role === "CLIENT") {
    if (!session.clientId) {
      await enregistrerEvenementSecurite({
        correlationId: nouveauCorrelationId(),
        action: "rbac.acces_refuse",
        resultat: "REFUSE",
        severite: "ATTENTION",
        contexteIp: adresseIp(req),
        contexteRoute: "/api/feuilles-de-temps",
        acteurEmail: session.email,
        acteurRole: session.role,
        ressourceType: "FeuilleDeTemps",
        detail: "Session Client sans clientId lors d'une lecture des feuilles de temps.",
      });
      return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    }
    const feuilles = await prisma.feuilleDeTemps.findMany({
      where: {
        mission: { clientId: session.clientId },
        statut: { in: ["ValideeAdmin", "ValideeClient"] },
      },
      include: { mission: { select: { id: true, repere: true, profil: { select: { nom: true } } } } },
      orderBy: { mois: "desc" },
    });
    return NextResponse.json({ feuilles });
  }

  return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
}

// Création/édition d'un brouillon + soumission — réservé à l'Ingénieur,
// uniquement sur ses propres missions.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "INGENIEUR" || !session.profilId) {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/feuilles-de-temps",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "FeuilleDeTemps",
      detail: "Tentative de création/soumission d'une feuille de temps par un rôle non-Ingénieur (ou profilId manquant).",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const body = await req.json();
  const { missionId, mois, joursTravailles, heuresSupplementaires, commentaire, soumettre, detailJours } = body;

  if (!missionId || !/^\d{4}-\d{2}$/.test(mois ?? "")) {
    return NextResponse.json({ error: "Mission et mois (AAAA-MM) requis." }, { status: 400 });
  }

  // Le détail jour par jour (calendrier façon Boond, voir
  // components/CalendrierCra.tsx) est la source de vérité quand il est
  // fourni : les totaux sont recalculés ici plutôt que de faire confiance
  // aux nombres agrégés envoyés par le client, pour éviter toute
  // incohérence entre le calendrier affiché et la feuille enregistrée.
  // Les anciennes feuilles (saisies avant l'ajout du calendrier) n'ont pas
  // de détail : dans ce cas on retombe sur les nombres agrégés envoyés.
  let jours: number;
  let heuresSup: number;
  if (Array.isArray(detailJours)) {
    const totaux = totauxDepuisDetail(detailJours);
    jours = totaux.joursTravailles;
    heuresSup = totaux.heuresSupplementaires;
  } else {
    jours = Number(joursTravailles);
    heuresSup = Number(heuresSupplementaires) || 0;
  }
  if (!Number.isFinite(jours) || jours < 0 || jours > 31) {
    return NextResponse.json({ error: "Nombre de jours travaillés invalide." }, { status: 400 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!mission || mission.profilId !== session.profilId) {
    return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });
  }

  const existante = await prisma.feuilleDeTemps.findUnique({
    where: { missionId_mois: { missionId, mois } },
  });
  if (existante && !craEstEditableParIngenieur(existante.statut)) {
    return NextResponse.json(
      { error: "Cette feuille de temps est déjà engagée dans le circuit de validation." },
      { status: 409 }
    );
  }

  const data = {
    missionId,
    mois,
    joursTravailles: jours,
    heuresSupplementaires: heuresSup,
    detailJours: Array.isArray(detailJours) ? detailJours : undefined,
    commentaire: commentaire?.trim() || null,
    statut: soumettre ? "Soumise" : "Brouillon",
    motifRejet: null as string | null,
    soumiseLe: soumettre ? new Date() : existante?.soumiseLe ?? null,
    valideeAdminLe: null as Date | null,
    valideeClientLe: null as Date | null,
  };

  const feuille = existante
    ? await prisma.feuilleDeTemps.update({ where: { id: existante.id }, data })
    : await prisma.feuilleDeTemps.create({ data });

  return NextResponse.json(feuille, { status: existante ? 200 : 201 });
}

// Validation Admin puis Client (ou rejet Admin) — voir lib/feuilles-de-temps.ts.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json();
  const { id, action, motifRejet } = body;
  if (!id || !action) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  const feuille = await prisma.feuilleDeTemps.findUnique({ where: { id }, include: { mission: true } });
  if (!feuille) return NextResponse.json({ error: "Feuille de temps introuvable." }, { status: 404 });

  if (session.role === "ADMIN") {
    if (feuille.statut !== "Soumise") {
      return NextResponse.json({ error: "Cette feuille n'est pas en attente de validation Admin." }, { status: 409 });
    }
    if (action === "validerAdmin") {
      const maj = await prisma.feuilleDeTemps.update({
        where: { id },
        data: { statut: "ValideeAdmin", valideeAdminLe: new Date() },
      });
      return NextResponse.json(maj);
    }
    if (action === "rejeter") {
      const motif = (motifRejet ?? "").trim() || "Non précisé.";
      const maj = await prisma.feuilleDeTemps.update({
        where: { id },
        data: { statut: "Rejetee", motifRejet: motif },
      });

      await journaliser({
        acteurEmail: session.email,
        acteurRole: "ADMIN",
        action: "rejet_cra",
        cible: feuille.id,
        detail: `Feuille de ${feuille.mois} (mission ${feuille.missionId}) rejetée — motif : ${motif}`,
      });

      // Notifie l'ingénieur — récupère son email via le profil de la mission
      // (le compte User n'est pas directement lié à la mission).
      const compteIngenieur = await prisma.user.findUnique({
        where: { profilId: feuille.mission.profilId },
        include: { profil: true },
      });
      if (compteIngenieur) {
        await envoyerEmailCraRejete({
          to: compteIngenieur.email,
          nom: compteIngenieur.profil?.nom ?? "",
          mois: libelleMois(feuille.mois),
          motif,
        });
      }

      return NextResponse.json(maj);
    }
    return NextResponse.json({ error: "Action invalide." }, { status: 400 });
  }

  if (session.role === "CLIENT") {
    if (!session.clientId || feuille.mission.clientId !== session.clientId) {
      // Isolation inter-client (object-level) : un Client ne peut jamais
      // agir sur une feuille de temps liée à la mission d'un AUTRE client —
      // distinct d'un simple refus de rôle, journalisé avec la ressource
      // concernée pour rester traçable (BOLA, directive B16 section 7).
      await enregistrerEvenementSecurite({
        correlationId: nouveauCorrelationId(),
        action: "rbac.acces_refuse",
        resultat: "REFUSE",
        severite: "ALERTE",
        contexteIp: adresseIp(req),
        contexteRoute: "/api/feuilles-de-temps",
        acteurEmail: session.email,
        acteurRole: session.role,
        ressourceType: "FeuilleDeTemps",
        ressourceId: feuille.id,
        detail: "Tentative de validation d'une feuille de temps liée à la mission d'un autre client (isolation inter-client).",
      });
      return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    }
    if (feuille.statut !== "ValideeAdmin") {
      return NextResponse.json({ error: "Cette feuille n'est pas en attente de votre validation." }, { status: 409 });
    }
    if (action === "validerClient") {
      const maj = await prisma.feuilleDeTemps.update({
        where: { id },
        data: { statut: "ValideeClient", valideeClientLe: new Date() },
      });
      return NextResponse.json(maj);
    }
    return NextResponse.json({ error: "Action invalide." }, { status: 400 });
  }

  // Rôle restant : INGENIEUR — jamais accès au circuit de validation
  // Admin/Client des feuilles de temps.
  await enregistrerEvenementSecurite({
    correlationId: nouveauCorrelationId(),
    action: "rbac.acces_refuse",
    resultat: "REFUSE",
    severite: "ALERTE",
    contexteIp: adresseIp(req),
    contexteRoute: "/api/feuilles-de-temps",
    acteurEmail: session.email,
    acteurRole: session.role,
    ressourceType: "FeuilleDeTemps",
    ressourceId: feuille.id,
    detail: "Tentative d'accès au circuit de validation Admin/Client par un Ingénieur.",
  });
  return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
}
