import { test, expect } from "@playwright/test";

// B14.4 — Tests sécurité du mot de passe oublié (voir
// app/api/auth/mot-de-passe-oublie/route.ts et
// app/api/auth/reinitialiser-mot-de-passe/route.ts, ajoutés en B14.1).
// Couvre : absence d'énumération d'email, rejet d'un token invalide/à
// usage unique, politique de mot de passe réutilisée, non-régression sur
// la connexion existante (client-demo@example.com, compte seedé actif).

test.describe("API — /api/auth/mot-de-passe-oublie", () => {
  test("réponse identique (200, même message) qu'un compte existe ou non — pas d'énumération d'email", async ({ request }) => {
    const reponseExistant = await request.post("/api/auth/mot-de-passe-oublie", {
      data: { email: "client-demo@example.com" },
    });
    const reponseInexistant = await request.post("/api/auth/mot-de-passe-oublie", {
      data: { email: "personne-nexiste-pas-du-tout@example.com" },
    });
    expect(reponseExistant.status()).toBe(200);
    expect(reponseInexistant.status()).toBe(200);
    const corpsExistant = await reponseExistant.json();
    const corpsInexistant = await reponseInexistant.json();
    expect(corpsExistant.message).toBe(corpsInexistant.message);
    // Le lien démo n'est renvoyé que si le compte existe réellement — mais
    // ce champ seul ne doit jamais suffire à distinguer les deux cas côté
    // code HTTP/message, ce qui est déjà vérifié ci-dessus.
    expect(corpsExistant.lienReinitialisationDemo).toBeTruthy();
    expect(corpsInexistant.lienReinitialisationDemo).toBeUndefined();
  });

  test("rejette un email mal formé (validation zod)", async ({ request }) => {
    const reponse = await request.post("/api/auth/mot-de-passe-oublie", {
      data: { email: "pas-un-email" },
    });
    expect(reponse.status()).toBe(400);
  });

  test("aucune fuite d'information : le corps ne contient jamais le hash du mot de passe ni un id interne", async ({ request }) => {
    const reponse = await request.post("/api/auth/mot-de-passe-oublie", {
      data: { email: "client-demo@example.com" },
    });
    const corpsBrut = await reponse.text();
    expect(corpsBrut).not.toContain("passwordHash");
    expect(corpsBrut.toLowerCase()).not.toContain("$2a$");
    expect(corpsBrut.toLowerCase()).not.toContain("$2b$"); // préfixe bcrypt
  });
});

test.describe("API — /api/auth/reinitialiser-mot-de-passe", () => {
  test("rejette un token inexistant", async ({ request }) => {
    const reponse = await request.post("/api/auth/reinitialiser-mot-de-passe", {
      data: { token: "token-invente-qui-nexiste-pas", nouveauMotDePasse: "NouveauTest2026!", confirmationNouveauMotDePasse: "NouveauTest2026!" },
    });
    expect(reponse.status()).toBe(400);
  });

  test("rejette une confirmation qui ne correspond pas (validation zod)", async ({ request }) => {
    const reponse = await request.post("/api/auth/reinitialiser-mot-de-passe", {
      data: { token: "peu-importe", nouveauMotDePasse: "NouveauTest2026!", confirmationNouveauMotDePasse: "Different2026!" },
    });
    expect(reponse.status()).toBe(400);
  });

  test("rejette un nouveau mot de passe trop court (même politique que signup)", async ({ request }) => {
    const demande = await request.post("/api/auth/mot-de-passe-oublie", {
      data: { email: "client-demo@example.com" },
    });
    const { lienReinitialisationDemo } = await demande.json();
    const token = new URL(`https://x${lienReinitialisationDemo}`).searchParams.get("token")!;

    const reponse = await request.post("/api/auth/reinitialiser-mot-de-passe", {
      data: { token, nouveauMotDePasse: "court", confirmationNouveauMotDePasse: "court" },
    });
    expect(reponse.status()).toBe(400);
  });

  test("cycle complet : réinitialisation réussie, ancien mot de passe refusé, nouveau accepté, token à usage unique", async ({ request }) => {
    // Compte jetable créé pour ce test (jamais le compte partagé
    // client-demo@example.com) : le mot de passe est vérifié via bcrypt dès
    // le login, avant tout contrôle actif/emailVerifie (voir
    // app/api/auth/login/route.ts), donc pas besoin d'activer/vérifier ce
    // compte pour observer le rejet de l'ancien mot de passe et l'acceptation
    // du nouveau. Évite aussi tout mot de passe de récupération "Demo1234" :
    // il est refusé par validerMotDePasse (fuite de données connue HaveIBeenPwned,
    // voir lib/password-policy.ts) — restaurer client-demo à Demo1234 via ce
    // flux serait donc impossible et casserait les autres tests partagés.
    const emailJetable = `test-reset-b144-${Date.now()}@example.com`;
    const motDePasseInitial = `InitialB144-${Date.now()}!`;
    const inscription = await request.post("/api/auth/signup", {
      data: {
        email: emailJetable,
        password: motDePasseInitial,
        role: "CLIENT",
        nom: "Client Test B14.4",
        telephone: "0600000000",
        consentementRgpd: true,
      },
    });
    expect(inscription.status()).toBe(201);

    const demande = await request.post("/api/auth/mot-de-passe-oublie", {
      data: { email: emailJetable },
    });
    const { lienReinitialisationDemo } = await demande.json();
    const token = new URL(`https://x${lienReinitialisationDemo}`).searchParams.get("token")!;

    const nouveauMotDePasse = `ReinitialiseB144-${Date.now()}!`;
    const reset = await request.post("/api/auth/reinitialiser-mot-de-passe", {
      data: { token, nouveauMotDePasse, confirmationNouveauMotDePasse: nouveauMotDePasse },
    });
    expect(reset.status()).toBe(200);

    // Token à usage unique : une seconde tentative avec le même token échoue.
    const reutilisation = await request.post("/api/auth/reinitialiser-mot-de-passe", {
      data: { token, nouveauMotDePasse: "AutreMotDePasse2026!", confirmationNouveauMotDePasse: "AutreMotDePasse2026!" },
    });
    expect(reutilisation.status()).toBe(400);

    // Ancien mot de passe (celui de l'inscription, avant réinitialisation)
    // refusé : bcrypt.compare échoue contre le nouveau hash -> 401.
    const ancienRefuse = await request.post("/api/auth/login", {
      data: { email: emailJetable, password: motDePasseInitial },
    });
    expect(ancienRefuse.status()).toBe(401);

    // Nouveau mot de passe accepté au niveau des identifiants : bcrypt.compare
    // réussit, donc jamais 401 — le compte reste ensuite bloqué en 403 par les
    // contrôles emailVerifie/actif (compte jetable jamais validé), ce qui
    // prouve que le mot de passe lui-même a bien été accepté.
    const nouveauAccepte = await request.post("/api/auth/login", {
      data: { email: emailJetable, password: nouveauMotDePasse },
    });
    expect(nouveauAccepte.status()).not.toBe(401);
    expect(nouveauAccepte.status()).toBe(403);
  });
});
