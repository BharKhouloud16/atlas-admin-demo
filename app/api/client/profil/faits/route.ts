import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { instancesActivesParCle, valeurDejaActive, normaliserValeur } from "@/lib/client-profile/faits";
import { dernierFaitParCle } from "@/lib/client-need/faits";
import type { ClientProfileFaitCle } from "@prisma/client";

// COMPANY ATLAS — LOT 4 : Profil Client Intelligence Foundation (15/09/2026).
//
// Endpoint dédié AJOUTER/CONFIRMER un ClientProfileFact — jamais une
// mutation en place (historique intégralement additif, décision CEO
// LOT 4). Aucun DELETE, aucune correction du texte d'une instance
// existante en V1 (limite explicite, voir consolidation).
//
// CONTEXTE_ACTIVITE (singleton) suit dernierFaitParCle (LOT 3, "dernière
// valeur gagne") ; les 8 autres clés (répétables) suivent la supersession
// logique via `confirmeDepuis` (lib/client-profile/faits.ts).
//
// Isolation identique aux routes existantes : clientId exclusivement de
// session, ownership du fait confirmé revérifiée avant toute écriture,
// 404 (jamais une fuite) si le fait référencé par CONFIRMER n'appartient
// pas au profil du client courant ou n'est plus actif.

const CLES_SINGLETON = new Set(["CONTEXTE_ACTIVITE"]);
const CLES_PROFIL = new Set<string>([
  "CONTEXTE_ACTIVITE",
  "ENJEU",
  "OBJECTIF_DURABLE",
  "PRIORITE_DURABLE",
  "CONTRAINTE_DURABLE",
  "PREFERENCE_DURABLE",
  "CRITERE_REUSSITE_DURABLE",
  "RISQUE_DURABLE",
  "BESOIN_RECURRENT_CONFIRME",
]);

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT" || !session.clientId) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

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

  const body = await req.json().catch(() => null);
  const cle = body?.cle;
  const action = body?.action;

  if (typeof cle !== "string" || !CLES_PROFIL.has(cle)) {
    return NextResponse.json({ error: "Clé invalide ou hors périmètre du profil." }, { status: 400 });
  }
  if (action !== "AJOUTER" && action !== "CONFIRMER") {
    return NextResponse.json({ error: "action doit être AJOUTER ou CONFIRMER." }, { status: 400 });
  }

  if (action === "AJOUTER") {
    const valeurBrute = body?.valeur;
    if (typeof valeurBrute !== "string" || valeurBrute.trim().length === 0) {
      return NextResponse.json({ error: "valeur requise (jamais une valeur inventée)." }, { status: 400 });
    }
    const valeur = valeurBrute.trim().slice(0, 300);
    const source = body?.depuisSignal === true ? "client_confirmation_signal" : "client";

    if (CLES_SINGLETON.has(cle)) {
      const actuel = dernierFaitParCle(profile.faits.filter((f) => f.cle === cle)).get(cle);
      if (actuel && normaliserValeur(actuel.valeur) === normaliserValeur(valeur)) {
        return NextResponse.json({ error: "Cette information est déjà présente dans votre profil." }, { status: 409 });
      }
    } else if (valeurDejaActive(profile.faits, cle, valeur)) {
      return NextResponse.json({ error: "Cette information est déjà présente dans votre profil." }, { status: 409 });
    }

    const nouveauFait = await prisma.clientProfileFact.create({
      data: { profileId: profile.id, cle: cle as ClientProfileFaitCle, valeur, statut: "DECLARE", source },
    });
    return NextResponse.json({ fait: nouveauFait }, { status: 201 });
  }

  // CONFIRMER
  const factIdACopier = body?.factIdACopier;
  if (typeof factIdACopier !== "string" || factIdACopier.trim().length === 0) {
    return NextResponse.json({ error: "factIdACopier requis pour confirmer." }, { status: 400 });
  }

  let factSource: { id: string; valeur: string } | undefined;
  if (CLES_SINGLETON.has(cle)) {
    const dernier = dernierFaitParCle(profile.faits.filter((f) => f.cle === cle)).get(cle);
    factSource = dernier?.id === factIdACopier ? dernier : undefined;
  } else {
    const actifs = instancesActivesParCle(profile.faits).get(cle) ?? [];
    factSource = actifs.find((f) => f.id === factIdACopier);
  }

  // Le fait référencé doit appartenir au profil du client de session ET
  // être actuellement actif — sinon 404, jamais une fuite d'existence sur
  // les données d'un autre client, jamais une double confirmation créant
  // deux instances actives pour la même information.
  if (!factSource) {
    return NextResponse.json({ error: "Fait introuvable ou déjà confirmé." }, { status: 404 });
  }

  const nouveauFait = await prisma.clientProfileFact.create({
    data: {
      profileId: profile.id,
      cle: cle as ClientProfileFaitCle,
      valeur: factSource.valeur,
      statut: "VERIFIE",
      source: "client_confirmation",
      confirmeDepuis: factSource.id,
    },
  });
  return NextResponse.json({ fait: nouveauFait }, { status: 201 });
}
