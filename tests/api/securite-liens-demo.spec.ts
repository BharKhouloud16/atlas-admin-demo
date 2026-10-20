import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";
import { POST as motDePasseOublie } from "@/app/api/auth/mot-de-passe-oublie/route";
import { POST as renvoyerVerification } from "@/app/api/auth/renvoyer-verification/route";
import { POST as inscription } from "@/app/api/auth/signup/route";
import { POST as reinitialiserMotDePasse } from "@/app/api/auth/reinitialiser-mot-de-passe/route";
import { POST as verifierEmail } from "@/app/api/auth/verifier-email/route";
import { empreinteEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";

// SÉCURITÉ — non-régression de la faille « lien de réinitialisation /
// vérification renvoyé dans la réponse HTTP ».
//
// Le serveur de la CI tourne avec ATLAS_LIENS_DEMO=oui (pour les parcours
// démo existants) : il ne peut donc pas montrer le comportement « variable
// absente ». Ces tests appellent les gestionnaires de route directement dans
// le processus de test, en faisant varier l'environnement, sur la base CI
// jetable (comptes de test identifiables, jamais de compte réel).
//
// Avant correctif, le cas « variable absente » échouait : le lien était
// renvoyé sans condition pour tout compte existant.

const VARIABLES = ["ATLAS_LIENS_DEMO", "VERCEL_ENV", "RESEND_API_KEY"] as const;
let sauvegarde: Record<string, string | undefined> = {};

test.beforeEach(() => {
  sauvegarde = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));
});
test.afterEach(() => {
  for (const v of VARIABLES) {
    if (sauvegarde[v] === undefined) delete process.env[v];
    else process.env[v] = sauvegarde[v];
  }
});

function definirEnv(env: Partial<Record<(typeof VARIABLES)[number], string>>) {
  for (const v of VARIABLES) delete process.env[v];
  Object.assign(process.env, env);
}

let compteurIp = 0;
function requete(chemin: string, corps: unknown) {
  compteurIp++;
  return new NextRequest(`http://localhost${chemin}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.99.${Math.floor(compteurIp / 250)}.${compteurIp % 250}` },
    // Une chaîne est envoyée telle quelle (corps volontairement mal formé).
    body: typeof corps === "string" ? corps : JSON.stringify(corps),
  });
}

async function corps(reponse: Response) {
  return { statut: reponse.status, texte: await reponse.text() };
}

// Hors Vercel, sans activation explicite : parcours complet, sans lien.
const ENVIRONNEMENTS_SANS_LIEN: [string, Partial<Record<(typeof VARIABLES)[number], string>>][] = [
  ["variable absente", {}],
  ["variable désactivée", { ATLAS_LIENS_DEMO: "non" }],
  ["valeur non exacte", { ATLAS_LIENS_DEMO: "true" }],
];

// Sur Vercel, même avec ATLAS_LIENS_DEMO=oui, et sans fournisseur d'email
// (RESEND_API_KEY absente, cas actuel) : refus 503 identique pour toute
// adresse, avant toute lecture en base — jamais de lien, jamais de compte
// créé, jamais un faux « email envoyé » (voir parcoursEmailIndisponible).
const ENVIRONNEMENTS_VERCEL_SANS_FOURNISSEUR: [string, Partial<Record<(typeof VARIABLES)[number], string>>][] = [
  ["Vercel Preview avec variable « oui »", { ATLAS_LIENS_DEMO: "oui", VERCEL_ENV: "preview" }],
  ["Vercel Production avec variable « oui »", { ATLAS_LIENS_DEMO: "oui", VERCEL_ENV: "production" }],
];

test.describe("Sécurité — /api/auth/mot-de-passe-oublie (appel direct du gestionnaire)", () => {
  for (const [nom, env] of ENVIRONNEMENTS_SANS_LIEN) {
    test(`${nom} : aucun lien ni jeton, réponse identique compte existant / inexistant`, async () => {
      definirEnv(env);
      const existant = await corps(await motDePasseOublie(requete("/api/auth/mot-de-passe-oublie", { email: "client-demo@example.com" })));
      const inexistant = await corps(
        await motDePasseOublie(requete("/api/auth/mot-de-passe-oublie", { email: `inconnu-${Date.now()}@example.com` }))
      );
      expect(existant.statut).toBe(200);
      expect(existant).toEqual(inexistant);
      expect(existant.texte).not.toContain("lienReinitialisationDemo");
      expect(existant.texte).not.toContain("token");
    });
  }

  test("activation explicite hors Vercel : lien renvoyé (environnement de test contrôlé)", async () => {
    definirEnv({ ATLAS_LIENS_DEMO: "oui" });
    const existant = await (await motDePasseOublie(requete("/api/auth/mot-de-passe-oublie", { email: "client-demo@example.com" }))).json();
    expect(existant.lienReinitialisationDemo).toMatch(/^\/reinitialiser-mot-de-passe\?token=[0-9a-f]{64}$/);
  });
});

test.describe("Sécurité — inscription et renvoi de vérification (appel direct des gestionnaires)", () => {
  // Le renvoi est différé si le dernier lien a moins de 2 minutes
  // (lib/renvoi-verification.ts) : on « vieillit » le lien du compte jetable
  // pour exercer le chemin de régénération réel.
  async function vieillirLien(email: string) {
    await prisma.user.update({ where: { email }, data: { emailVerificationExpire: new Date() } });
  }

  async function inscrireCompteJetable(emailImpose?: string) {
    const email = emailImpose ?? `test-securite-liens-${Date.now()}-${compteurIp}@example.com`;
    const reponse = await inscription(
      requete("/api/auth/signup", {
        email,
        password: `Securite-${Date.now()}-Zx!`,
        role: "CLIENT",
        nom: "Client Test Sécurité Liens",
        telephone: "0600000000",
        consentementRgpd: true,
      })
    );
    return { email, reponse: await corps(reponse) };
  }

  for (const [nom, env] of ENVIRONNEMENTS_SANS_LIEN) {
    test(`${nom} : l'inscription ne renvoie aucun lien de vérification`, async () => {
      definirEnv(env);
      const { reponse } = await inscrireCompteJetable();
      expect(reponse.statut).toBe(201);
      expect(reponse.texte).not.toContain("lienVerificationDemo");
      expect(reponse.texte).not.toContain("token");
      expect(JSON.parse(reponse.texte).id).toBeUndefined();
    });

    test(`${nom} : inscription avec une adresse déjà inscrite — réponse identique à une adresse libre (anti-énumération)`, async () => {
      definirEnv(env);
      const { email, reponse: nouvelle } = await inscrireCompteJetable();
      const { reponse: doublon } = await inscrireCompteJetable(email);
      const { reponse: compteSeede } = await inscrireCompteJetable("client-demo@example.com");
      expect(doublon).toEqual(nouvelle);
      expect(compteSeede).toEqual(nouvelle);
    });

    test(`${nom} : renvoi de vérification identique pour un compte non vérifié, vérifié ou inexistant`, async () => {
      definirEnv(env);
      const { email } = await inscrireCompteJetable(); // compte non vérifié
      await vieillirLien(email);
      const nonVerifie = await corps(await renvoyerVerification(requete("/api/auth/renvoyer-verification", { email })));
      const verifie = await corps(
        await renvoyerVerification(requete("/api/auth/renvoyer-verification", { email: "client-demo@example.com" }))
      );
      const inexistant = await corps(
        await renvoyerVerification(requete("/api/auth/renvoyer-verification", { email: `inconnu-${Date.now()}@example.com` }))
      );
      expect(nonVerifie.statut).toBe(200);
      expect(nonVerifie).toEqual(verifie);
      expect(nonVerifie).toEqual(inexistant);
      expect(nonVerifie.texte).not.toContain("lienVerificationDemo");
    });
  }

  test("activation explicite hors Vercel : liens de vérification renvoyés (environnement de test contrôlé)", async () => {
    definirEnv({ ATLAS_LIENS_DEMO: "oui" });
    const { email, reponse } = await inscrireCompteJetable();
    expect(JSON.parse(reponse.texte).lienVerificationDemo).toMatch(/^\/verifier-email\?token=[0-9a-f]{64}$/);
    await vieillirLien(email);
    const renvoi = await (await renvoyerVerification(requete("/api/auth/renvoyer-verification", { email }))).json();
    expect(renvoi.lienVerificationDemo).toMatch(/^\/verifier-email\?token=[0-9a-f]{64}$/);
  });

  test("renvoi de vérification : un second renvoi dans les 2 minutes ne régénère ni n'envoie de lien", async () => {
    definirEnv({});
    const { email } = await inscrireCompteJetable();
    await vieillirLien(email);
    const premier = await corps(await renvoyerVerification(requete("/api/auth/renvoyer-verification", { email })));
    const jetonApresPremier = (await prisma.user.findUnique({ where: { email } }))?.emailVerificationToken;
    const second = await corps(await renvoyerVerification(requete("/api/auth/renvoyer-verification", { email })));
    const jetonApresSecond = (await prisma.user.findUnique({ where: { email } }))?.emailVerificationToken;
    expect(second).toEqual(premier);
    expect(jetonApresSecond).toBe(jetonApresPremier);
  });

  test("renvoi de vérification : limitation par IP -> 429 (mécanisme de lib/rate-limit.ts)", async () => {
    definirEnv({});
    const ip = `10.98.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const max = Number(process.env.RATE_LIMIT_LOGIN_MAX_IP) || 20;
    // Compteur amené au seuil directement (base CI jetable), plutôt que
    // `max` appels réels (1000 en CI).
    await prisma.tentativeIp.upsert({
      where: { cle: `renvoyer-verification:${ip}` },
      create: { cle: `renvoyer-verification:${ip}`, compteur: max, fenetreDebut: new Date() },
      update: { compteur: max, fenetreDebut: new Date() },
    });
    const reponse = await renvoyerVerification(
      new NextRequest("http://localhost/api/auth/renvoyer-verification", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ email: `inconnu-${Date.now()}@example.com` }),
      })
    );
    expect(reponse.status).toBe(429);
  });

  test("renvoi de vérification : corps non-JSON ou email manquant -> 400", async () => {
    const nonJson = new NextRequest("http://localhost/api/auth/renvoyer-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{pas du json",
    });
    expect((await renvoyerVerification(nonJson)).status).toBe(400);
    expect((await renvoyerVerification(requete("/api/auth/renvoyer-verification", {}))).status).toBe(400);
  });
});

test.describe("Sécurité — Vercel sans fournisseur d'email : refus honnête et identique (appel direct)", () => {
  for (const [nom, env] of ENVIRONNEMENTS_VERCEL_SANS_FOURNISSEUR) {
    test(`${nom} : 503 identique pour toute adresse, aucun lien, aucun compte créé`, async () => {
      definirEnv(env);
      const emailNeuf = `test-securite-503-${Date.now()}-${compteurIp}@example.com`;
      const reponses = [
        await corps(await motDePasseOublie(requete("/api/auth/mot-de-passe-oublie", { email: "client-demo@example.com" }))),
        await corps(await motDePasseOublie(requete("/api/auth/mot-de-passe-oublie", { email: emailNeuf }))),
        await corps(await renvoyerVerification(requete("/api/auth/renvoyer-verification", { email: "client-demo@example.com" }))),
        await corps(await renvoyerVerification(requete("/api/auth/renvoyer-verification", { email: emailNeuf }))),
        await corps(
          await inscription(
            requete("/api/auth/signup", {
              email: emailNeuf,
              password: `Securite-${Date.now()}-Zx!`,
              role: "CLIENT",
              nom: "Client Test 503",
              telephone: "0600000000",
              consentementRgpd: true,
            })
          )
        ),
      ];
      for (const r of reponses) {
        expect(r.statut).toBe(503);
        expect(r).toEqual(reponses[0]);
        expect(r.texte).not.toContain("token");
        expect(r.texte).not.toContain("lien");
      }
      expect(await prisma.user.findUnique({ where: { email: emailNeuf } })).toBeNull();
    });
  }
});

test.describe("Sécurité — requêtes simultanées et usage unique (appel direct, base CI jetable)", () => {
  async function inscrire(email: string) {
    const r = await inscription(
      requete("/api/auth/signup", {
        email,
        password: `Securite-${Date.now()}-Zx!`,
        role: "CLIENT",
        nom: "Client Test Concurrence",
        telephone: "0600000000",
        consentementRgpd: true,
      })
    );
    return r.json();
  }

  test("renvois simultanés pour un même compte : un seul lien régénéré, un seul email tenté", async () => {
    definirEnv({});
    const email = `test-securite-concurrence-${Date.now()}@example.com`;
    await inscrire(email);
    await prisma.user.update({ where: { email }, data: { emailVerificationExpire: new Date() } });
    const appels: string[] = [];
    const original = console.log;
    console.log = (...a: unknown[]) => void appels.push(a.map(String).join(" "));
    try {
      const reponses = await Promise.all(
        Array.from({ length: 8 }, () => renvoyerVerification(requete("/api/auth/renvoyer-verification", { email })))
      );
      for (const r of reponses) expect(r.status).toBe(200);
    } finally {
      console.log = original;
    }
    const emails = appels.filter((l) => l.includes("[email:placeholder]") && l.includes(empreinteEmail(email)));
    expect(emails.length).toBe(1);
  });

  test("réinitialisation : un jeton ne sert qu'une fois, même en requêtes simultanées", async () => {
    definirEnv({ ATLAS_LIENS_DEMO: "oui" });
    const email = `test-securite-reset-${Date.now()}@example.com`;
    await inscrire(email);
    const { lienReinitialisationDemo } = await (
      await motDePasseOublie(requete("/api/auth/mot-de-passe-oublie", { email }))
    ).json();
    const token = new URL(`https://x${lienReinitialisationDemo}`).searchParams.get("token")!;
    const statuts = await Promise.all(
      [1, 2, 3, 4].map(async (i) => {
        const mdp = `Concurrent-${i}-${Date.now()}-Zx!`;
        const r = await reinitialiserMotDePasse(
          requete("/api/auth/reinitialiser-mot-de-passe", { token, nouveauMotDePasse: mdp, confirmationNouveauMotDePasse: mdp })
        );
        return r.status;
      })
    );
    expect(statuts.filter((s) => s === 200).length).toBe(1);
    expect(statuts.filter((s) => s === 400).length).toBe(3);
  });

  test("vérification d'adresse : un lien ne sert qu'une fois, même en requêtes simultanées", async () => {
    definirEnv({ ATLAS_LIENS_DEMO: "oui" });
    const email = `test-securite-verif-${Date.now()}@example.com`;
    const { lienVerificationDemo } = await inscrire(email);
    const token = new URL(`https://x${lienVerificationDemo}`).searchParams.get("token")!;
    const statuts = await Promise.all(
      [1, 2, 3].map(async () => (await verifierEmail(requete("/api/auth/verifier-email", { token }))).status)
    );
    expect(statuts.filter((s) => s === 200).length).toBe(1);
    expect((await prisma.user.findUnique({ where: { email } }))?.emailVerifie).toBe(true);
  });

  test("corps non-JSON : 400 contrôlé sur mot de passe oublié, réinitialisation et vérification", async () => {
    definirEnv({});
    for (const [chemin, gestionnaire] of [
      ["/api/auth/mot-de-passe-oublie", motDePasseOublie],
      ["/api/auth/reinitialiser-mot-de-passe", reinitialiserMotDePasse],
      ["/api/auth/verifier-email", verifierEmail],
    ] as const) {
      const r = await gestionnaire(requete(chemin, "{pas du json"));
      expect(r.status, chemin).toBe(400);
    }
  });
});
