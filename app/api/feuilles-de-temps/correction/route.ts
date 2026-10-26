import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { erreurSaisieCra, libelleMois, missionEstClose, totauxDepuisDetail, type JourCra } from "@/lib/feuilles-de-temps";
import { lireCorpsJson } from "@/lib/api-errors";
import { adresseIp } from "@/lib/rate-limit";
import { enregistrerEvenementSecurite, nouveauCorrelationId } from "@/lib/security/events";

// Correction Admin d'une feuille de temps sur une mission CLOSE (lot CRA V1,
// 25/10/2026). L'Ingénieur ne peut plus saisir sur une mission close (voir
// POST /api/feuilles-de-temps) ; seul l'Admin peut encore créer ou corriger
// la feuille d'un mois, selon une procédure contrôlée :
//   - motif obligatoire (au moins 10 caractères) ;
//   - refus si une Facture existe déjà pour cette feuille (une facture émise
//     ne se corrige pas par le CRA) ;
//   - même contrôle des saisies que l'Ingénieur, et écriture conditionnée à
//     la version lue (aucune correction concurrente écrasée) ;
//   - la feuille corrigée repart en « Validée Admin » : le Client doit la
//     valider de nouveau avant toute facturation ;
//   - trace (avant, après, motif, auteur) écrite dans la MÊME transaction
//     que la correction : une correction n'existe jamais sans sa trace.
const LONGUEUR_MOTIF_MIN = 10;

function resume(f: { joursTravailles: number; heuresSupplementaires: number; statut: string } | null) {
  return f ? `${f.joursTravailles} j / ${f.heuresSupplementaires} h sup (${f.statut})` : "aucune feuille";
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    await enregistrerEvenementSecurite({
      correlationId: nouveauCorrelationId(),
      action: "rbac.acces_refuse",
      resultat: "REFUSE",
      severite: "ALERTE",
      contexteIp: adresseIp(req),
      contexteRoute: "/api/feuilles-de-temps/correction",
      acteurEmail: session?.email ?? null,
      acteurRole: session?.role ?? null,
      ressourceType: "FeuilleDeTemps",
      detail: "Tentative de correction de feuille de temps par un rôle non-Admin.",
    });
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  const body = await lireCorpsJson(req);
  if (body === null || typeof body !== "object") {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  const { missionId, mois, detailJours, joursTravailles, heuresSupplementaires, commentaire, motif, versionLue } = body as Record<string, unknown>;

  if (typeof missionId !== "string" || !missionId || typeof mois !== "string" || !/^\d{4}-\d{2}$/.test(mois)) {
    return NextResponse.json({ error: "Mission et mois (AAAA-MM) requis." }, { status: 400 });
  }
  const motifCorrection = typeof motif === "string" ? motif.trim() : "";
  if (motifCorrection.length < LONGUEUR_MOTIF_MIN) {
    return NextResponse.json({ error: `Motif de correction obligatoire (au moins ${LONGUEUR_MOTIF_MIN} caractères).` }, { status: 400 });
  }
  const erreurSaisie = erreurSaisieCra(mois, { detailJours, joursTravailles, heuresSupplementaires });
  if (erreurSaisie) return NextResponse.json({ error: erreurSaisie }, { status: 400 });

  const mission = await prisma.mission.findUnique({ where: { id: missionId }, select: { id: true, statut: true } });
  if (!mission) return NextResponse.json({ error: "Mission introuvable." }, { status: 404 });
  if (!missionEstClose(mission.statut)) {
    return NextResponse.json(
      { error: "Cette mission est en cours : la feuille de temps suit le circuit normal (saisie Ingénieur, validation Admin puis Client)." },
      { status: 409 }
    );
  }

  const existante = await prisma.feuilleDeTemps.findUnique({
    where: { missionId_mois: { missionId, mois } },
    include: { facture: { select: { id: true } } },
  });
  if (existante?.facture) {
    return NextResponse.json(
      { error: "Une facture existe déjà pour cette feuille de temps : elle ne peut plus être corrigée par le CRA." },
      { status: 409 }
    );
  }
  const conflit = NextResponse.json(
    { error: "Cette feuille de temps a été modifiée entre-temps. Rechargez-la avant de la corriger." },
    { status: 409 }
  );
  if (versionLue !== undefined && (versionLue ?? null) !== (existante ? existante.updatedAt.toISOString() : null)) {
    return conflit;
  }

  const totaux = Array.isArray(detailJours)
    ? totauxDepuisDetail(detailJours as JourCra[])
    : { joursTravailles: Number(joursTravailles), heuresSupplementaires: Number(heuresSupplementaires) || 0 };
  const maintenant = new Date();
  const data = {
    joursTravailles: totaux.joursTravailles,
    heuresSupplementaires: totaux.heuresSupplementaires,
    detailJours: Array.isArray(detailJours) ? (detailJours as Prisma.InputJsonValue) : Prisma.DbNull,
    commentaire: typeof commentaire === "string" ? commentaire.trim() || null : existante?.commentaire ?? null,
    statut: "ValideeAdmin",
    motifRejet: null,
    soumiseLe: existante?.soumiseLe ?? maintenant,
    valideeAdminLe: maintenant,
    valideeClientLe: null,
  };

  try {
    const feuille = await prisma.$transaction(async (tx) => {
      let resultat;
      if (existante) {
        const { count } = await tx.feuilleDeTemps.updateMany({ where: { id: existante.id, updatedAt: existante.updatedAt }, data });
        if (count === 0) throw new CorrectionConcurrente();
        resultat = await tx.feuilleDeTemps.findUniqueOrThrow({ where: { id: existante.id } });
      } else {
        resultat = await tx.feuilleDeTemps.create({ data: { ...data, missionId, mois } });
      }
      await tx.journalActivite.create({
        data: {
          acteurEmail: session.email,
          acteurRole: "ADMIN",
          action: "correction_cra_mission_close",
          cible: resultat.id,
          detail: `Correction Admin de la feuille de ${libelleMois(mois)} (mission ${missionId}, ${mission.statut}) : ${resume(existante)} → ${resume(resultat)}. Motif : ${motifCorrection}`,
        },
      });
      return resultat;
    });
    return NextResponse.json(feuille, { status: existante ? 200 : 201 });
  } catch (erreur) {
    if (erreur instanceof CorrectionConcurrente) return conflit;
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") return conflit;
    throw erreur;
  }
}

class CorrectionConcurrente extends Error {}
