import { test, expect, APIRequestContext } from "@playwright/test";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — ENGINEER ACCESS & TRUST (09/10/2026).
//
// Couvre les 30 scénarios obligatoires du mandat §23, adaptés au contrat
// réel découvert par l'audit (voir rapport final). Aucun test ne
// réimplémente la suite existante (auth.spec.ts, b44-engineer-profile-v1.
// spec.ts, a21/a8) — ce fichier verrouille exclusivement ce qui est NOUVEAU
// dans ce lot : connexion candidate limitée, espace candidature, CV
// hardening (taille/nom/hash), signaux Access Integrity, décisions
// APPROUVER/REFUSER/DEMANDER_INFORMATIONS, isolation.

const MOT_DE_PASSE = "MotDePasseTest1234";

function suffixe() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function inscrireIngenieur(
  request: APIRequestContext,
  overrides: { nom?: string; prenom?: string; ip?: string } = {}
) {
  const s = suffixe();
  const email = `engineer-trust-${s}@example.com`;
  const headers = overrides.ip ? { "x-forwarded-for": overrides.ip } : undefined;
  const reponse = await request.post("/api/auth/signup", {
    data: {
      email,
      password: MOT_DE_PASSE,
      role: "INGENIEUR",
      nom: overrides.nom ?? `NomTrust${s}`,
      prenom: overrides.prenom ?? "Prenom",
      consentementRgpd: true,
    },
    headers,
  });
  expect(reponse.status(), await reponse.text()).toBe(201);
  const body = await reponse.json();
  const token = new URL(`https://x${body.lienVerificationDemo}`).searchParams.get("token")!;
  return { email, password: MOT_DE_PASSE, userId: body.id as string, token };
}

async function verifierEmail(request: APIRequestContext, token: string) {
  const r = await request.post("/api/auth/verifier-email", { data: { token } });
  expect(r.status(), await r.text()).toBe(200);
}

async function connecter(request: APIRequestContext, email: string, password = MOT_DE_PASSE) {
  return request.post("/api/auth/login", { data: { email, password } });
}

async function connecterAdmin(request: APIRequestContext) {
  const r = await connecter(request, "admin-demo@example.com", "Demo1234");
  expect(r.ok(), await r.text()).toBeTruthy();
}

// Candidat prêt (inscrit + email vérifié + session candidate active sur ce
// `request`) — helper partagé par les tests qui n'ont besoin de ce point de
// départ que comme précondition.
async function creerCandidatPret(request: APIRequestContext, overrides: { nom?: string; prenom?: string; ip?: string } = {}) {
  const candidat = await inscrireIngenieur(request, overrides);
  await verifierEmail(request, candidat.token);
  const login = await connecter(request, candidat.email, candidat.password);
  expect(login.status(), await login.text()).toBe(200);
  return candidat;
}

function pdfMinimal(contenuDistinctif: string) {
  return Buffer.from(`%PDF-1.4\n% ${contenuDistinctif}\n%%EOF`);
}

test.describe("ENGINEER ACCESS & TRUST — Inscription / Email / Décision toujours en attente", () => {
  test("1/2/3/4. inscription -> login refusé avant vérification -> vérification -> login réussit mais reste non approuvé", async ({ request }) => {
    const candidat = await inscrireIngenieur(request);

    const avant = await prisma.user.findUniqueOrThrow({ where: { id: candidat.userId } });
    expect(avant.actif).toBe(false);
    expect(avant.emailVerifie).toBe(false);

    const loginAvantVerif = await connecter(request, candidat.email, candidat.password);
    expect(loginAvantVerif.status()).toBe(403);

    await verifierEmail(request, candidat.token);

    const loginApresVerif = await connecter(request, candidat.email, candidat.password);
    expect(loginApresVerif.status(), await loginApresVerif.text()).toBe(200);
    const body = await loginApresVerif.json();
    expect(body.redirect).toBe("/ingenieur/candidature");

    const statut = await request.get("/api/ingenieur/candidature");
    expect(statut.status()).toBe(200);
    const statutBody = await statut.json();
    expect(statutBody.emailVerifie).toBe(true);
    expect(statutBody.actif).toBe(false); // 4. toujours non approuvé après vérification email
  });
});

test.describe("ENGINEER ACCESS & TRUST — Espace candidature (accès limité)", () => {
  test("5/6/8. accès candidat limité : candidature/CV accessibles, Mission/Client/Talent interdits", async ({ request }) => {
    await creerCandidatPret(request);

    expect((await request.get("/api/ingenieur/candidature")).status()).toBe(200);
    expect((await request.get("/api/ingenieur/cv/infos")).status()).not.toBe(403);

    expect((await request.get("/api/missions")).status()).toBe(403);
    expect((await request.get("/api/client/missions")).status()).toBe(403);
    expect((await request.get("/api/talent/besoins")).status()).toBe(403);
  });

  test("7. candidat A ne peut lire que sa propre candidature — aucun paramètre d'id n'influence la réponse (IDOR structurellement impossible)", async ({ request }) => {
    const candidatA = await creerCandidatPret(request);
    const reponse = await request.get(`/api/ingenieur/candidature?userId=une-autre-valeur-ignoree`);
    const body = await reponse.json();
    // La route ne lit jamais de paramètre d'id : elle retourne toujours la
    // candidature de la session courante (candidat A), jamais une autre.
    const candidatAEnBase = await prisma.user.findUniqueOrThrow({ where: { id: candidatA.userId } });
    expect(body.emailVerifie).toBe(candidatAEnBase.emailVerifie);
    expect(body.actif).toBe(candidatAEnBase.actif);
  });
});

test.describe("ENGINEER ACCESS & TRUST — CV (upload sécurisé)", () => {
  // 9. BLOB_READ_WRITE_TOKEN n'est configuré ni en local ni en CI dans ce
  // repo (voir tests/api/lot12-security-hardening.spec.ts, test 1, qui
  // verrouille déjà ce fait et le message d'erreur générique attendu) :
  // l'upload d'un CV valide en espace candidature (actif=false) ne peut
  // donc jamais atteindre 200 dans cet environnement, ni en lot12 ni ici.
  // Ce test vérifie à la place que la requête d'un candidat (actif=false)
  // franchit TOUTES les validations avant stockage (MIME, taille) et
  // échoue EXACTEMENT comme en lot12 (même message générique, jamais une
  // régression de validation qui la ferait échouer plus tôt pour une autre
  // raison). Le calcul/la persistance de cvHash sur un stockage réussi sont
  // couverts au niveau de la logique des signaux par le test 16 ci-dessous,
  // via une empreinte posée directement en base (même limite d'environnement).
  test("9. upload CV valide en espace candidature (actif=false) atteint le stockage et échoue identiquement au comportement déjà verrouillé (BLOB_READ_WRITE_TOKEN absent, contrat lot12)", async ({ request }) => {
    await creerCandidatPret(request);
    const reponse = await request.post("/api/ingenieur/cv", {
      multipart: { cv: { name: "cv.pdf", mimeType: "application/pdf", buffer: pdfMinimal(suffixe()) } },
    });
    expect(reponse.status()).toBe(500);
    const corps = await reponse.json();
    expect(corps.error).toBe("Échec de l'upload du CV. Veuillez réessayer.");
    expect(corps.error).not.toContain("BLOB_READ_WRITE_TOKEN");
  });

  test("10. type de fichier interdit rejeté (400), aucune donnée stockée", async ({ request }) => {
    await creerCandidatPret(request);
    const reponse = await request.post("/api/ingenieur/cv", {
      multipart: { cv: { name: "cv.txt", mimeType: "text/plain", buffer: Buffer.from("texte") } },
    });
    expect(reponse.status()).toBe(400);
  });

  test("11. fichier trop volumineux rejeté (400)", async ({ request }) => {
    await creerCandidatPret(request);
    const gros = Buffer.alloc(11 * 1024 * 1024, 65); // 11 Mo > limite de 10 Mo
    const reponse = await request.post("/api/ingenieur/cv", {
      multipart: { cv: { name: "cv.pdf", mimeType: "application/pdf", buffer: gros } },
    });
    expect(reponse.status()).toBe(400);
  });

  // 12/13. GET /api/ingenieur/cv/fichier (code préexistant, non modifié par
  // ce lot) ne lit JAMAIS ?profilId lorsque l'appelant a une session
  // INGENIEUR — il résout toujours sa PROPRE session.profilId, quel que
  // soit le paramètre fourni (même pattern structurel que la candidature,
  // test 7). Ce n'est donc jamais un contrôle "vérifier puis rejeter avec
  // 403" : le paramètre n'a structurellement aucune influence, ce qui rend
  // l'IDOR impossible par construction plutôt que par vérification. On le
  // prouve ici en montrant que la réponse de B est RIGOUREUSEMENT IDENTIQUE
  // qu'il fournisse le profilId réel de A ou une valeur arbitraire.
  test("12/13. accès au CV strictement privé — le paramètre profilId n'a aucune influence pour une session Ingénieur (IDOR structurellement impossible)", async ({ request }) => {
    const candidatA = await creerCandidatPret(request);
    const userA = await prisma.user.findUniqueOrThrow({ where: { id: candidatA.userId } });

    const candidatB = await creerCandidatPret(request);
    const avecIdDeA = await request.get(`/api/ingenieur/cv/fichier?profilId=${userA.profilId}`);
    const avecIdArbitraire = await request.get(`/api/ingenieur/cv/fichier?profilId=une-valeur-arbitraire-ignoree`);

    expect(avecIdDeA.status()).toBe(avecIdArbitraire.status());
    expect(await avecIdDeA.json()).toEqual(await avecIdArbitraire.json());
    // Jamais le CV de A : B n'a pas encore de CV stocké dans cet
    // environnement (voir test 9), donc la seule réponse possible est
    // "Aucun CV importé", jamais un contenu appartenant à A.
    expect(avecIdDeA.status()).toBe(404);
    expect(candidatB.email).not.toBe(candidatA.email);
  });
});

test.describe("ENGINEER ACCESS & TRUST — Access Integrity (signaux explicables)", () => {
  test("14. téléphone réutilisé — signal absent, jamais fabriqué (aucune donnée collectée pour ce champ)", async ({ request }) => {
    const candidat = await creerCandidatPret(request);
    await connecterAdmin(request);
    const dossier = await request.get(`/api/comptes/${candidat.userId}`);
    const body = await dossier.json();
    const cles = body.accessIntegrity.map((s: { cle: string }) => s.cle);
    expect(cles).not.toContain("telephone_reutilise");
  });

  test("15. identité déclarée déjà connue détectée (même nom+prénom sur un autre compte)", async ({ request }) => {
    const s = suffixe();
    await creerCandidatPret(request, { nom: `Doublon${s}`, prenom: "Jean" });
    const candidat2 = await creerCandidatPret(request, { nom: `Doublon${s}`, prenom: "Jean" });

    await connecterAdmin(request);
    const dossier = await request.get(`/api/comptes/${candidat2.userId}`);
    const body = await dossier.json();
    const signal = body.accessIntegrity.find((sig: { cle: string }) => sig.cle === "identite_connue");
    expect(signal.valeur).toContain("Oui");
  });

  // 16. Le stockage réel (Blob) n'est configuré ni en local ni en CI (voir
  // test 9 et tests/api/lot12-security-hardening.spec.ts) : un upload CV ne
  // peut donc jamais atteindre 200 dans cet environnement, pour personne.
  // Ce test cible exclusivement la logique NOUVELLE de ce lot — le calcul
  // du signal "cv_identique" à partir de deux `Profil.cvHash` identiques
  // (lib/engineer-access/integrity.ts) — en posant directement cette
  // empreinte en base, comme l'aurait fait un upload réussi (dont le code
  // est déjà couvert au niveau validation par les tests 9/10/11).
  test("16. CV identique détecté (même empreinte exacte sur deux profils)", async ({ request }) => {
    const empreinte = crypto.createHash("sha256").update(pdfMinimal(suffixe())).digest("hex");

    const candidat1 = await creerCandidatPret(request);
    const user1 = await prisma.user.findUniqueOrThrow({ where: { id: candidat1.userId } });
    await prisma.profil.update({ where: { id: user1.profilId! }, data: { cvHash: empreinte } });

    const candidat2 = await creerCandidatPret(request);
    const user2 = await prisma.user.findUniqueOrThrow({ where: { id: candidat2.userId } });
    await prisma.profil.update({ where: { id: user2.profilId! }, data: { cvHash: empreinte } });

    await connecterAdmin(request);
    const dossier = await request.get(`/api/comptes/${candidat2.userId}`);
    const body = await dossier.json();
    const signal = body.accessIntegrity.find((sig: { cle: string }) => sig.cle === "cv_identique");
    expect(signal.valeur).toContain("Oui");
  });

  test("17. comptes historiques/inscriptions associées détectés via la même adresse IP, signal d'automatisation", async ({ request }) => {
    const ipPartagee = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;
    await inscrireIngenieur(request, { ip: ipPartagee });
    const candidat2 = await inscrireIngenieur(request, { ip: ipPartagee });

    await connecterAdmin(request);
    const dossier = await request.get(`/api/comptes/${candidat2.userId}`);
    const body = await dossier.json();
    const associees = body.accessIntegrity.find((sig: { cle: string }) => sig.cle === "inscriptions_associees");
    expect(associees.valeur).toBe("1");
    const automatisation = body.accessIntegrity.find((sig: { cle: string }) => sig.cle === "automatisation");
    expect(automatisation.valeur).toContain("Détecté");
  });

  test("18/19. signaux explicables, jamais un score opaque (fraudScore/trustScore/AIProbability absents de toute la réponse)", async ({ request }) => {
    const candidat = await creerCandidatPret(request);
    await connecterAdmin(request);
    const dossier = await request.get(`/api/comptes/${candidat.userId}`);
    const texteComplet = JSON.stringify(await dossier.json());
    expect(texteComplet.toLowerCase()).not.toMatch(/fraudscore|trustscore|aiprobability|"score"/);

    const reponseListe = await request.get(`/api/comptes/${candidat.userId}`);
    const body = await reponseListe.json();
    for (const signal of body.accessIntegrity) {
      expect(typeof signal.label).toBe("string");
      expect(typeof signal.valeur).toBe("string"); // jamais un nombre brut sans libellé
    }
  });
});

test.describe("ENGINEER ACCESS & TRUST — Décision Admin", () => {
  test("20/24. Admin peut approuver — actif=true, email, décision auditée (journaliser)", async ({ request }) => {
    const candidat = await creerCandidatPret(request);
    await connecterAdmin(request);
    const reponse = await request.patch("/api/comptes", { data: { userId: candidat.userId, decision: "APPROUVER" } });
    expect(reponse.status(), await reponse.text()).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: candidat.userId } });
    expect(user.actif).toBe(true);
    expect(user.valideLe).toBeTruthy();

    const journal = await prisma.journalActivite.findFirst({ where: { action: "validation_compte", cible: candidat.userId }, orderBy: { createdAt: "desc" } });
    expect(journal).not.toBeNull();
    expect(journal?.acteurEmail).toBe("admin-demo@example.com");
  });

  test("21/23/24. Admin peut refuser avec raison — actif reste false, décision auditée ; refus sans raison rejeté", async ({ request }) => {
    const candidat = await creerCandidatPret(request);
    await connecterAdmin(request);

    const sansRaison = await request.patch("/api/comptes", { data: { userId: candidat.userId, decision: "REFUSER" } });
    expect(sansRaison.status()).toBe(400); // 23

    const avecRaison = await request.patch("/api/comptes", { data: { userId: candidat.userId, decision: "REFUSER", raison: "Expérience insuffisante pour nos besoins actuels." } });
    expect(avecRaison.status(), await avecRaison.text()).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: candidat.userId } });
    expect(user.actif).toBe(false); // jamais changé par un refus

    const decision = await prisma.engineerAccessDecision.findFirst({ where: { userId: candidat.userId, decision: "REFUSER" } });
    expect(decision?.raison).toBe("Expérience insuffisante pour nos besoins actuels.");

    const journal = await prisma.journalActivite.findFirst({ where: { action: "refus_compte", cible: candidat.userId } });
    expect(journal).not.toBeNull();
  });

  test("22/24. Admin peut demander des informations — le candidat voit la demande dans son espace candidature", async ({ request }) => {
    const candidat = await creerCandidatPret(request);
    await connecterAdmin(request);
    const reponse = await request.patch("/api/comptes", {
      data: { userId: candidat.userId, decision: "DEMANDER_INFORMATIONS", raison: "Merci de préciser vos années d'expérience en DevOps." },
    });
    expect(reponse.status(), await reponse.text()).toBe(200);

    const journal = await prisma.journalActivite.findFirst({ where: { action: "demande_informations_compte", cible: candidat.userId } });
    expect(journal).not.toBeNull();

    // Le candidat se reconnecte (sa session Admin ayant remplacé la sienne
    // sur ce `request`) pour constater la demande dans son propre espace.
    await connecter(request, candidat.email, candidat.password);
    const statut = await request.get("/api/ingenieur/candidature");
    const body = await statut.json();
    expect(body.derniereDecision.decision).toBe("DEMANDER_INFORMATIONS");
    expect(body.derniereDecision.raison).toContain("DevOps");
    expect(body.actif).toBe(false);
  });
});

test.describe("ENGINEER ACCESS & TRUST — Isolation / RBAC", () => {
  test("25/26/27/28. cross-candidate, Client et Engineer non-admin rejetés — aucune fuite cross-rôle", async ({ request }) => {
    const candidatA = await creerCandidatPret(request);

    // 27. un Ingénieur non-admin (même déjà approuvé) ne peut jamais décider.
    await connecter(request, "ingenieur-demo@example.com", "Demo1234");
    const decisionParIngenieur = await request.patch("/api/comptes", { data: { userId: candidatA.userId, decision: "APPROUVER" } });
    expect(decisionParIngenieur.status()).toBe(403);

    // 25. un candidat (actif=false) ne peut jamais lire le dossier d'un autre.
    const candidatB = await creerCandidatPret(request);
    const lectureCroisee = await request.get(`/api/comptes/${candidatA.userId}`);
    expect(lectureCroisee.status()).toBe(403);
    expect(candidatB.email).not.toBe(candidatA.email);

    // 26. CLIENT n'a jamais accès au dossier candidat.
    await connecter(request, "client-demo@example.com", "Demo1234");
    expect((await request.get("/api/comptes")).status()).toBe(403);
    expect((await request.get(`/api/comptes/${candidatA.userId}`)).status()).toBe(403);
  });
});

test.describe("ENGINEER ACCESS & TRUST — Professional Trust ≠ Access", () => {
  test("29/30. approbation de l'accès n'implique jamais une validation professionnelle ni une éligibilité Mission", async ({ request }) => {
    const candidat = await creerCandidatPret(request);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: candidat.userId } });

    const avantAssignments = await prisma.missionAssignment.count({ where: { talentId: user.profilId! } });
    const avantCapabilityLinks = await prisma.missionCapabilityLink.count();

    await connecterAdmin(request);
    await request.patch("/api/comptes", { data: { userId: candidat.userId, decision: "APPROUVER" } });

    const profilApres = await prisma.profil.findUniqueOrThrow({ where: { id: user.profilId! } });
    expect(profilApres.cvValide).toBe(false); // jamais auto-validé par l'approbation d'accès
    expect(profilApres.questionnaireValide).toBe(false);

    const apresAssignments = await prisma.missionAssignment.count({ where: { talentId: user.profilId! } });
    expect(apresAssignments).toBe(avantAssignments); // aucune éligibilité Mission créée

    const apresCapabilityLinks = await prisma.missionCapabilityLink.count();
    expect(apresCapabilityLinks).toBe(avantCapabilityLinks);
  });
});
