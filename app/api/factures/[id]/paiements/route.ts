import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";
import { journaliser } from "@/lib/audit";
import { enregistrerPaiement } from "@/lib/billing/paiement";

// COMPANY ATLAS — V2.2-B : Billing Foundation — Paiements d'une Facture.
//
// GET : Admin (tous), Client (uniquement sa propre facture, uniquement si
// déjà envoyée — même ownership que app/api/factures/[id]/route.ts, 404
// anti-fuite). POST (enregistrement) : Admin uniquement, jamais le Client —
// un paiement est toujours constaté et saisi par l'équipe Atlas, jamais
// auto-déclaré. Concurrence/idempotence entièrement déléguées à
// lib/billing/paiement.ts (transaction Serializable + contrainte @@unique
// sur [factureId, reference]) — cette route ne fait que valider la forme
// de l'entrée, jamais la logique financière elle-même.
async function chargerFactureAutorisee(
  factureId: string,
  session: { role: string; clientId?: string | null }
): Promise<{ ok: true; clientId: string; devise: string } | { ok: false; status: number }> {
  const facture = await prisma.facture.findUnique({ where: { id: factureId }, select: { clientId: true, devise: true, dateEnvoi: true } });
  if (!facture) return { ok: false, status: 404 };
  if (session.role === "ADMIN") return { ok: true, clientId: facture.clientId, devise: facture.devise };
  if (session.role === "CLIENT" && session.clientId === facture.clientId && facture.dateEnvoi) {
    return { ok: true, clientId: facture.clientId, devise: facture.devise };
  }
  return { ok: false, status: 404 };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (session.role === "INGENIEUR") return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });

  const { id } = await params;
  const autorisation = await chargerFactureAutorisee(id, session);
  if (!autorisation.ok) {
    if (session.role === "CLIENT") {
      await enregistrerEvenementSecurite({
        correlationId: nouveauCorrelationId(),
        action: "rbac.acces_refuse",
        resultat: "REFUSE",
        severite: "ALERTE",
        contexteIp: adresseIp(req),
        contexteRoute: "/api/factures/[id]/paiements",
        acteurEmail: session.email,
        acteurRole: session.role,
        ressourceType: "Facture",
        ressourceId: id,
        detail: "Tentative de lecture des paiements d'une facture n'appartenant pas au client courant.",
      });
    }
    return NextResponse.json({ error: "Facture introuvable." }, { status: autorisation.status });
  }

  const paiements = await prisma.paiement.findMany({ where: { factureId: id, statut: "CONFIRME" }, orderBy: { datePaiement: "desc" } });
  return NextResponse.json({
    paiements: paiements.map((p) => ({ id: p.id, montant: p.montant.toNumber(), devise: p.devise, datePaiement: p.datePaiement, methode: p.methode })),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/factures/[id]/paiements",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "Facture",
      detail: "Tentative d'enregistrement d'un paiement par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const montant = Number(body.montant);
  const devise = typeof body.devise === "string" ? body.devise : "";
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  const methode = typeof body.methode === "string" ? body.methode.trim() : "";
  const datePaiement = body.datePaiement ? new Date(body.datePaiement) : new Date();

  if (!reference || !methode || !Number.isFinite(datePaiement.getTime())) {
    return NextResponse.json({ error: "Paramètres de paiement invalides." }, { status: 400 });
  }

  const resultat = await enregistrerPaiement({ factureId: id, montant, devise, datePaiement, reference, methode });

  if (!resultat.ok) {
    const messages: Record<string, string> = {
      FACTURE_INTROUVABLE: "Facture introuvable.",
      FACTURE_NON_PAYABLE: "Cette facture n'est pas dans un état permettant d'enregistrer un paiement.",
      MONTANT_INVALIDE: "Le montant du paiement doit être strictement positif.",
      DEVISE_INCOHERENTE: "La devise du paiement ne correspond pas à celle de la facture.",
      SOLDE_DEPASSE: "Ce paiement dépasse le solde restant dû sur cette facture.",
    };
    const status = resultat.code === "FACTURE_INTROUVABLE" ? 404 : 409;
    return NextResponse.json({ error: messages[resultat.code] }, { status });
  }

  if (!resultat.dejaEnregistre) {
    await journaliser({
      acteurEmail: session.email,
      acteurRole: "ADMIN",
      action: "enregistrement_paiement",
      cible: resultat.paiement.id,
      detail: `Paiement de ${resultat.paiement.montant.toString()} ${resultat.paiement.devise} enregistré sur la facture ${id} (réf. ${resultat.paiement.reference}).`,
    });
  }

  return NextResponse.json(
    { paiement: { id: resultat.paiement.id, montant: resultat.paiement.montant.toNumber(), devise: resultat.paiement.devise } },
    { status: resultat.dejaEnregistre ? 200 : 201 }
  );
}
