import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Prisma, type ClientNeedStatut } from "@prisma/client";

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
const STATUTS_PROJET_CLOS = new Set(["ABANDONNE", "TERMINE"]);

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

  const body = await req.json().catch(() => null);
  const data: { titre?: string | null; statut?: ClientNeedStatut } = {};

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
    // REV-01 (01/11/2026) : le besoin qui porte un projet actif se gère
    // depuis l'onglet Projets — l'archiver ici désynchroniserait le projet.
    if (data.statut === "ARCHIVE") {
      const projet = await prisma.projet.findUnique({ where: { needId: besoin.id }, select: { titre: true, statut: true } });
      if (projet && !STATUTS_PROJET_CLOS.has(projet.statut)) {
        return NextResponse.json(
          { error: `Ce besoin porte le projet « ${projet.titre} » : il ne peut pas être archivé tant que le projet est actif. Gérez-le depuis l'onglet Projets.`, projet: true },
          { status: 409 }
        );
      }
    }
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

  // REV-01 (01/11/2026) — cohérence des données : un besoin n'est jamais
  // supprimé s'il porte un projet (le projet, ses propositions et son
  // historique en dépendent) ni s'il a une demande en cours de traitement
  // par l'équipe ATLAS (elle serait effacée en cascade). L'archivage reste
  // possible et ne supprime rien.
  const [projet, demandesEnCours] = await Promise.all([
    prisma.projet.findUnique({ where: { needId: besoin.id }, select: { titre: true } }),
    prisma.actionTalentClient.count({ where: { needId: besoin.id, statut: { in: ["ENVOYEE", "PRISE_EN_CHARGE"] } } }),
  ]);
  if (projet) {
    return NextResponse.json(
      { error: `Ce besoin porte le projet « ${projet.titre} » : il ne peut pas être supprimé. Pour arrêter, abandonnez le projet depuis l'onglet Projets.`, projet: true },
      { status: 409 }
    );
  }
  if (demandesEnCours > 0) {
    return NextResponse.json(
      { error: "Une demande liée à ce besoin est en cours de traitement par l'équipe ATLAS : il ne peut pas être supprimé. Vous pouvez l'archiver." },
      { status: 409 }
    );
  }

  // onDelete: Cascade (ClientNeedFait -> ClientNeed) — les faits associés
  // sont supprimés avec le besoin, aucune ligne orpheline.
  try {
    await prisma.clientNeed.delete({ where: { id: params.id } });
  } catch (e) {
    // Course : un projet a été créé sur ce besoin entre la vérification et la
    // suppression — la contrainte de clé étrangère protège les données.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return NextResponse.json({ error: "Ce besoin vient d'être rattaché à un projet : il ne peut pas être supprimé." }, { status: 409 });
    }
    throw e;
  }

  return NextResponse.json({ ok: true });
}
