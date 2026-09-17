import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { journaliser } from "@/lib/audit";
import { creerFactureDepuisFeuille } from "@/lib/billing/creation";
import { adapterFactureClient } from "@/lib/billing/adapter";

// COMPANY ATLAS — V2.2-B : Billing Foundation — API Facture.
//
// Même patron que app/api/feuilles-de-temps/route.ts : un seul endpoint,
// comportement différent selon le rôle, jamais un Ingénieur (défense en
// profondeur — voir middleware.ts, qui laisse passer les 3 rôles
// authentifiés mais délègue tout le détail RBAC ici).
//
// GET — Admin : toutes les Factures. Client : uniquement les siennes ET
// uniquement celles déjà envoyées (dateEnvoi non nul — voir le commentaire
// de Facture dans prisma/schema.prisma), toujours via
// adapterFactureClient() (frontière Client-safe, lib/billing/adapter.ts) —
// jamais l'entité Prisma brute (montantHT/TVA/TTC en Decimal, complianceSnapshot
// interne, regleFiscaleId...).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (session.role === "ADMIN") {
    const factures = await prisma.facture.findMany({
      include: { paiements: true, client: { select: { nom: true } }, mission: { select: { repere: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ factures });
  }

  if (session.role === "CLIENT") {
    if (!session.clientId) {
      await enregistrerEvenementSecurite({
        correlationId: nouveauCorrelationId(),
        action: "rbac.acces_refuse",
        resultat: "REFUSE",
        severite: "ATTENTION",
        contexteIp: adresseIp(req),
        contexteRoute: "/api/factures",
        acteurEmail: session.email,
        acteurRole: session.role,
        ressourceType: "Facture",
        detail: "Session Client sans clientId lors d'une lecture des factures.",
      });
      return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    }
    const factures = await prisma.facture.findMany({
      where: { clientId: session.clientId, dateEnvoi: { not: null } },
      include: { paiements: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ factures: factures.map(adapterFactureClient) });
  }

  await enregistrerEvenementSecurite({
    correlationId: nouveauCorrelationId(),
    action: "rbac.acces_refuse",
    resultat: "REFUSE",
    severite: "ALERTE",
    contexteIp: adresseIp(req),
    contexteRoute: "/api/factures",
    acteurEmail: session.email,
    acteurRole: session.role,
    ressourceType: "Facture",
    detail: "Tentative d'accès aux factures par un rôle non autorisé (Ingénieur).",
  });
  return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
}

// POST — Admin uniquement : crée (ou récupère, idempotent) la Facture
// correspondant à une FeuilleDeTemps ValideeClient. `feuilleDeTempsId`
// jamais un `clientId`/`missionId` fourni par l'appelant — ceux-ci sont
// toujours dérivés de la FeuilleDeTemps elle-même côté serveur (aucun mass
// assignment possible, voir lib/billing/creation.ts).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/factures",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Facture",
      detail: "Tentative de création de facture par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const feuilleDeTempsId = typeof body.feuilleDeTempsId === "string" ? body.feuilleDeTempsId : null;
  if (!feuilleDeTempsId) {
    return NextResponse.json({ error: "feuilleDeTempsId requis." }, { status: 400 });
  }

  const resultat = await creerFactureDepuisFeuille(feuilleDeTempsId);
  if (!resultat.ok) {
    if (resultat.code === "FEUILLE_INTROUVABLE") {
      return NextResponse.json({ error: "Feuille de temps introuvable." }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Cette feuille de temps n'est pas encore validée par le Client — facturation impossible." },
      { status: 409 }
    );
  }

  if (!resultat.dejaExistante) {
    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "creation_facture",
      cible: resultat.facture.id,
      detail: `Facture ${resultat.facture.numeroFacture} créée depuis la feuille de temps ${feuilleDeTempsId}.`,
    });
  }

  return NextResponse.json({ facture: resultat.facture, dejaExistante: resultat.dejaExistante }, { status: resultat.dejaExistante ? 200 : 201 });
}
