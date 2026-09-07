import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { adresseIp, verifierLimiteIp } from "@/lib/rate-limit";
import { supprimerFichier } from "@/lib/storage";
import { journaliser } from "@/lib/audit";

// OUTIL DE MAINTENANCE PONCTUEL — pas une fonctionnalité ATLAS, pas listé
// dans le middleware, à SUPPRIMER après usage (voir commit de suivi).
//
// Objectif (demande explicite de l'utilisatrice, 7 sept.) : repartir d'un
// environnement de démo VIERGE avant une nouvelle campagne de test —
// supprimer tous les comptes/CV/profils/missions/CRA/documents/demandes
// accumulés lors des tests précédents (y compris les comptes créés avec de
// vraies adresses email pendant les tests d'inscription), SANS toucher au
// code ni aux fonctionnalités, et SANS dégrader la sécurité.
//
// Portée volontairement limitée à ce qui est réellement une donnée de
// test/démo dans ce dépôt (il n'existe aucune donnée "métier réelle"
// séparée : toute la base sert uniquement à la démonstration) :
// supprimés -> User, Client, Profil (cascade VersionCv/InfoCV/
// ProfilCompetence/SkillEvidence), Mission, FeuilleDeTemps, Evaluation,
// Document, DemandeTalent (cascade ShortlistEntree), DemandeContact,
// JournalActivite, TentativeIp. JAMAIS touché : `Hypotheses` (paramètres
// financiers globaux de l'application, pas une donnée de test).
//
// SÉCURITÉ (au moins aussi stricte que les autres actions Admin) :
// - Exige une session ADMIN valide (même garde que /admin/* — pas de jeton
//   séparé à distribuer, pas de nouvelle surface d'attaque non authentifiée).
// - Exige un paramètre de confirmation explicite (`confirmation=SUPPRIMER-TOUT`)
//   pour qu'un simple clic/prefetch de lien ne déclenche jamais l'opération.
// - Rate-limité par IP comme /api/dev-seed.
// - Recrée un unique compte ADMIN (admin-demo@example.com) avec un mot de
//   passe ALÉATOIRE à usage unique renvoyé une seule fois dans la réponse —
//   jamais "Demo1234" en production. Nécessaire : sans Admin, personne ne
//   peut valider les futures inscriptions ni exécuter le Matching Engine.
// - Suppression best-effort des fichiers Vercel Blob (CV/vidéos/documents)
//   associés, pour ne laisser aucun fichier orphelin accessible par URL
//   signée résiduelle.
// - Une seule ligne de JournalActivite est écrite APRÈS le nettoyage (le
//   journal lui-même est vidé avant), pour garder une trace de l'opération
//   sans faire persister aucune ancienne donnée de test dans le journal.

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }

  const ip = adresseIp(req);
  const autorise = await verifierLimiteIp(`dev-reset:${ip}`);
  if (!autorise) {
    return NextResponse.json(
      { error: "Trop de tentatives sur cette route depuis cette adresse. Réessayez plus tard." },
      { status: 429 }
    );
  }

  const confirmation = req.nextUrl.searchParams.get("confirmation");
  if (confirmation !== "SUPPRIMER-TOUT") {
    return NextResponse.json(
      {
        error:
          "Confirmation manquante. Cette opération supprime IRRÉVERSIBLEMENT toutes les données de démo/test. Rappelez cette route avec ?confirmation=SUPPRIMER-TOUT pour l'exécuter.",
      },
      { status: 400 }
    );
  }

  // Récupère toutes les URLs de fichiers Blob AVANT suppression des lignes
  // qui les référencent (best-effort, jamais bloquant sur l'opération DB).
  const [profilsAvecFichiers, versionsCv, documents] = await Promise.all([
    prisma.profil.findMany({ select: { cvUrl: true, videoUrl: true } }),
    prisma.versionCv.findMany({ select: { cvUrl: true } }),
    prisma.document.findMany({ select: { fileUrl: true } }),
  ]);
  const urlsBlob = [
    ...profilsAvecFichiers.flatMap((p) => [p.cvUrl, p.videoUrl]),
    ...versionsCv.map((v) => v.cvUrl),
    ...documents.map((d) => d.fileUrl),
  ].filter((u): u is string => !!u);

  const motDePasseAdmin = crypto.randomBytes(9).toString("base64url");
  const passwordHash = await bcrypt.hash(motDePasseAdmin, 12);

  const compteurs = await prisma.$transaction(async (tx) => {
    const evaluations = await tx.evaluation.deleteMany({});
    const feuilles = await tx.feuilleDeTemps.deleteMany({});
    const docs = await tx.document.deleteMany({});
    const demandesTalent = await tx.demandeTalent.deleteMany({}); // cascade ShortlistEntree
    const missions = await tx.mission.deleteMany({});
    const demandesContact = await tx.demandeContact.deleteMany({});
    const users = await tx.user.deleteMany({});
    const profils = await tx.profil.deleteMany({}); // cascade VersionCv/InfoCV/ProfilCompetence/SkillEvidence
    const clients = await tx.client.deleteMany({});
    const tentativesIp = await tx.tentativeIp.deleteMany({});
    const journal = await tx.journalActivite.deleteMany({});

    const admin = await tx.user.create({
      data: {
        email: "admin-demo@example.com",
        passwordHash,
        role: "ADMIN",
        actif: true,
        valideLe: new Date(),
      },
    });

    return {
      evaluations: evaluations.count,
      feuilles: feuilles.count,
      documents: docs.count,
      demandesTalent: demandesTalent.count,
      missions: missions.count,
      demandesContact: demandesContact.count,
      users: users.count,
      profils: profils.count,
      clients: clients.count,
      tentativesIp: tentativesIp.count,
      journal: journal.count,
      adminId: admin.id,
    };
  });

  // Suppression best-effort des fichiers Blob — hors transaction (appels
  // réseau externes), n'affecte jamais le résultat déjà commité en base.
  const resultatsBlob = await Promise.allSettled(urlsBlob.map((u) => supprimerFichier(u)));
  const blobsEchoues = resultatsBlob.filter((r) => r.status === "rejected").length;

  // Trace unique de l'opération, écrite APRÈS coup (le journal vient d'être
  // vidé) — référence le nouveau compte Admin, pas l'ancien (supprimé).
  await journaliser({
    acteurEmail: "admin-demo@example.com",
    acteurRole: "ADMIN",
    action: "nettoyage_environnement_demo",
    detail: `Environnement de démo réinitialisé : ${compteurs.users} comptes, ${compteurs.clients} clients, ${compteurs.profils} profils, ${compteurs.missions} missions, ${compteurs.feuilles} CRA, ${compteurs.documents} documents, ${compteurs.demandesTalent} demandes talent, ${compteurs.demandesContact} demandes de contact supprimés. ${urlsBlob.length} fichier(s) Blob ciblé(s) pour suppression (${blobsEchoues} échec(s) best-effort, jamais bloquant).`,
  });

  return NextResponse.json({
    ok: true,
    message: `Environnement nettoyé. Nouveau compte Admin : admin-demo@example.com — mot de passe (affiché une seule fois) : ${motDePasseAdmin}`,
    supprime: compteurs,
    fichiersBlobCibles: urlsBlob.length,
    fichiersBlobEchoues: blobsEchoues,
  });
}
