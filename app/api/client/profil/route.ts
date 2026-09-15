import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { instancesActivesParCle } from "@/lib/client-profile/faits";
import { dernierFaitParCle } from "@/lib/client-need/faits";
import { detecterRecurrences } from "@/lib/client-profile/recurrence";

// COMPANY ATLAS — LOT 4 : Profil Client Intelligence Foundation (15/09/2026).
//
// Réservé CLIENT — même discipline que /api/client/besoins* : clientId
// dérivé EXCLUSIVEMENT de session.clientId, jamais accepté depuis le corps
// de la requête. GET agrège identité (Client, inchangé structurellement,
// LOT 4 décision A) + faits de profil actifs (ClientProfileFact) + résumé
// besoins (ClientNeed, LOT 2/3, jamais copié) + résumé résultats
// (Mission/Evaluation, LOT 1, jamais copié) + signaux de récurrence
// (calculés à la volée, jamais stockés tant que non confirmés).

const CHAMPS_IDENTITE_CLIENT = [
  "id",
  "nom",
  "pays",
  "secteur",
  "contactReferent",
  "email",
  "telephone",
  "identifiantEntreprise",
  "formeJuridique",
] as const;

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const client = await prisma.client.findUnique({
    where: { id: session.clientId },
    select: Object.fromEntries(CHAMPS_IDENTITE_CLIENT.map((c) => [c, true])),
  });
  if (!client) {
    return NextResponse.json({ error: "Client introuvable." }, { status: 404 });
  }

  // Créé paresseusement au premier accès — jamais à l'inscription (aucune
  // donnée inventée avant qu'un profil ne soit réellement consulté).
  let profile = await prisma.clientProfile.findUnique({
    where: { clientId: session.clientId },
    include: { faits: true },
  });
  if (!profile) {
    profile = await prisma.clientProfile.create({
      data: { clientId: session.clientId },
      include: { faits: true },
    });
  }

  const contexteActuel = dernierFaitParCle(profile.faits.filter((f) => f.cle === "CONTEXTE_ACTIVITE"));
  const actifsRepetables = instancesActivesParCle(profile.faits.filter((f) => f.cle !== "CONTEXTE_ACTIVITE"));
  const faitsActifs = [...(contexteActuel.get("CONTEXTE_ACTIVITE") ? [contexteActuel.get("CONTEXTE_ACTIVITE")!] : []), ...[...actifsRepetables.values()].flat()];

  const besoins = await prisma.clientNeed.findMany({
    where: { clientId: session.clientId },
    select: { id: true, titre: true, texteOriginal: true, statut: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const besoinsOuverts = besoins.filter((b) => b.statut === "SOUMIS" || b.statut === "A_CLARIFIER").length;

  const faitsBesoinsPourRecurrence = await prisma.clientNeedFait.findMany({
    where: { need: { clientId: session.clientId } },
    select: { cle: true, valeur: true, needId: true },
  });
  const signauxRecurrence = detecterRecurrences(faitsBesoinsPourRecurrence);

  const missions = await prisma.mission.findMany({
    where: { clientId: session.clientId },
    select: { evaluation: { select: { note: true } } },
  });
  const notes = missions.map((m) => m.evaluation?.note).filter((n): n is number => typeof n === "number");
  const noteMoyenne = notes.length > 0 ? notes.reduce((a, b) => a + b, 0) / notes.length : null;

  return NextResponse.json({
    client,
    profile: { id: profile.id, createdAt: profile.createdAt, updatedAt: profile.updatedAt },
    faits: faitsActifs,
    besoins: { total: besoins.length, ouverts: besoinsOuverts, recents: besoins.slice(0, 5) },
    resultats: { missionsRealisees: missions.length, noteMoyenne, nombreEvaluations: notes.length },
    signauxRecurrence,
  });
}

const CHAMPS_MODIFIABLES = new Set([
  "nom",
  "pays",
  "secteur",
  "contactReferent",
  "email",
  "telephone",
  "identifiantEntreprise",
  "formeJuridique",
]);

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const data: Record<string, string | null> = {};
  for (const champ of CHAMPS_MODIFIABLES) {
    if (!(champ in body)) continue;
    const brut = body[champ];

    if (champ === "nom") {
      if (typeof brut !== "string" || brut.trim().length === 0) {
        return NextResponse.json({ error: "nom ne peut jamais être vide." }, { status: 400 });
      }
      data.nom = brut.trim().slice(0, 200);
      continue;
    }

    if (brut !== null && typeof brut !== "string") {
      return NextResponse.json({ error: `${champ} invalide.` }, { status: 400 });
    }
    data[champ] = brut === null ? null : brut.trim().slice(0, 200);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Aucune modification fournie." }, { status: 400 });
  }

  // session.clientId identifie directement le Client à modifier — jamais un
  // id fourni par le corps de la requête (isolation stricte).
  const client = await prisma.client.update({
    where: { id: session.clientId },
    data,
    select: Object.fromEntries(CHAMPS_IDENTITE_CLIENT.map((c) => [c, true])),
  });

  return NextResponse.json({ client });
}
