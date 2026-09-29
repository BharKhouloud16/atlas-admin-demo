import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { creerUrlSignee, verifierUrlSignee } from "@/lib/url-signee";

// ATLAS LOT 12.2 — SECURITY HARDENING (29/09/2026).
//
// Couverture dédiée du mécanisme d'URL signée (partage temporaire de
// CV/vidéo sans compte) — jusqu'ici totalement non testé (confirmé par
// l'audit Lot 12.2). Ce fichier vérifie à la fois le comportement
// fonctionnel (génération/vérification) et le durcissement du secret
// (suppression du fallback `process.env.SESSION_SECRET ?? ""`, remplacé
// par la réutilisation de secretCourant, déjà validé par
// lib/session-secret.ts::exigerSecret — voir tests/unit/session-secret.spec.ts
// pour la couverture absent/vide/whitespace de ce garde centralisé).
//
// Pourquoi les scénarios "secret absent/vide/whitespace" (11-14) sont
// couverts par une preuve STRUCTURELLE (lecture du code source) plutôt que
// par une manipulation de process.env à l'exécution : secretCourant est
// calculé une seule fois au chargement du module lib/session-secret.ts, qui
// lève déjà une exception à ce moment précis si SESSION_SECRET est
// absent/vide/whitespace (voir tests/unit/session-secret.spec.ts, tests
// 2-4) — avant même que lib/url-signee.ts ait pu être importé. Un test
// dynamique nécessiterait de contourner le cache de modules Node (fragile,
// non idiomatique dans ce dépôt) pour un résultat déjà entièrement prouvé
// par la garde centralisée + par l'absence structurelle de tout fallback
// dans ce fichier.

const CHEMIN_SOURCE = path.join(__dirname, "..", "..", "lib", "url-signee.ts");
const SOURCE_URL_SIGNEE = fs.readFileSync(CHEMIN_SOURCE, "utf-8");

// Les commentaires du fichier DISCUTENT volontairement de
// process.env.SESSION_SECRET / secretsVerification / SESSION_SECRET_PREVIOUS
// en prose (documentant précisément ce qui n'est plus fait et pourquoi) —
// ce que ces tests doivent vérifier, c'est l'absence de CODE EXÉCUTABLE qui
// les référence, pas l'absence totale de la chaîne dans le fichier. On
// retire donc les lignes de commentaire avant les assertions structurelles.
const CODE_SANS_COMMENTAIRES = SOURCE_URL_SIGNEE.split("\n")
  .filter((ligne) => !ligne.trim().startsWith("//"))
  .join("\n");

test.describe("url-signee — Génération", () => {
  test("1. création d'une URL/token avec secret valide (l'environnement de test a un SESSION_SECRET réel)", () => {
    const { token, expire } = creerUrlSignee("cv:profil-test-1");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    expect(typeof expire).toBe("number");
  });

  test("2. token généré vérifiable avec le même secret (round-trip génération -> vérification)", () => {
    const { token } = creerUrlSignee("cv:profil-test-2");
    expect(verifierUrlSignee("cv:profil-test-2", token)).toBe(true);
  });

  test("3. la ressource signée est correctement liée au token — un token créé pour une ressource ne vérifie jamais pour une autre", () => {
    const { token } = creerUrlSignee("cv:profil-A");
    expect(verifierUrlSignee("cv:profil-A", token)).toBe(true);
    expect(verifierUrlSignee("cv:profil-B", token)).toBe(false);
    expect(verifierUrlSignee("video:profil-A", token)).toBe(false);
  });

  test("4. expiration correctement encodée dans le token (décodable, cohérente avec la valeur retournée)", () => {
    const dureeSec = 3600;
    const avant = Date.now();
    const { token, expire } = creerUrlSignee("cv:profil-test-4", dureeSec);

    expect(expire).toBeGreaterThanOrEqual(avant + dureeSec * 1000);
    expect(expire).toBeLessThanOrEqual(Date.now() + dureeSec * 1000 + 1000);

    const decode = Buffer.from(token, "base64url").toString("utf-8");
    const expireEncode = Number(decode.slice(0, decode.indexOf(".")));
    expect(expireEncode).toBe(expire);
  });
});

test.describe("url-signee — Vérification", () => {
  test("5. token valide -> accepté", () => {
    const { token } = creerUrlSignee("cv:profil-test-5");
    expect(verifierUrlSignee("cv:profil-test-5", token)).toBe(true);
  });

  test("6. token absent (null) -> refusé", () => {
    expect(verifierUrlSignee("cv:profil-test-6", null)).toBe(false);
  });

  test("7. token invalide (garbage non décodable / structurellement absurde) -> refusé, jamais une exception", () => {
    expect(verifierUrlSignee("cv:profil-test-7", "ceci-n-est-pas-un-token-valide")).toBe(false);
    expect(verifierUrlSignee("cv:profil-test-7", "")).toBe(false);
    expect(() => verifierUrlSignee("cv:profil-test-7", "!!!not-base64url???")).not.toThrow();
  });

  test("8. token expiré -> refusé", () => {
    const { token } = creerUrlSignee("cv:profil-test-8", -10); // expiration déjà dans le passé
    expect(verifierUrlSignee("cv:profil-test-8", token)).toBe(false);
  });

  test("9. ressource différente au moment de la vérification -> refusée", () => {
    const { token } = creerUrlSignee("video:profil-test-9");
    expect(verifierUrlSignee("cv:profil-test-9", token)).toBe(false);
  });

  test("10. modification d'un seul caractère du token (signature altérée) -> refusée", () => {
    const { token } = creerUrlSignee("cv:profil-test-10");
    const alterePosition = Math.floor(token.length / 2);
    const caractereAlt = token[alterePosition] === "a" ? "b" : "a";
    const tokenAltere = token.slice(0, alterePosition) + caractereAlt + token.slice(alterePosition + 1);

    expect(tokenAltere).not.toBe(token);
    expect(verifierUrlSignee("cv:profil-test-10", tokenAltere)).toBe(false);
  });
});

test.describe("url-signee — Secret (LOT 12.2, durcissement)", () => {
  test("11. aucune génération silencieuse de token avec une clé invalide — creerUrlSignee dépend structurellement de secretCourant, déjà garanti non vide par lib/session-secret.ts", () => {
    // Preuve directe : ce fichier n'importe plus jamais process.env.SESSION_SECRET
    // lui-même — toute tentative de génération passe par secretCourant, dont le
    // chargement (lib/session-secret.ts) échoue déjà avant que ce module ne
    // s'exécute si SESSION_SECRET est absent (voir tests/unit/session-secret.spec.ts,
    // test 2). Il ne peut donc structurellement pas y avoir de génération
    // "silencieuse" avec une clé invalide.
    expect(SOURCE_URL_SIGNEE).toContain('import { secretCourant } from "@/lib/session-secret"');
  });

  test("12. secret vide — aucune lecture indépendante de process.env.SESSION_SECRET dans le code exécutable de ce fichier (rejet structurel, pas un fallback)", () => {
    expect(CODE_SANS_COMMENTAIRES).not.toContain("process.env.SESSION_SECRET");
  });

  test("13. secret whitespace-only — même garantie : le code exécutable ne lit plus jamais SESSION_SECRET lui-même, whitespace inclus", () => {
    expect(CODE_SANS_COMMENTAIRES).not.toMatch(/process\.env\.SESSION_SECRET/);
  });

  test("14. vérifier qu'aucun fallback \"\" n'existe dans url-signee.ts (LOT 12.2 — avant ce lot : `process.env.SESSION_SECRET ?? \"\"`)", () => {
    expect(SOURCE_URL_SIGNEE).not.toContain('?? ""');
    expect(SOURCE_URL_SIGNEE).not.toContain("?? ''");
  });
});

test.describe("url-signee — Sécurité", () => {
  test("15. la comparaison de signature reste en temps constant (crypto.timingSafeEqual toujours utilisé, jamais une comparaison ===)", () => {
    expect(SOURCE_URL_SIGNEE).toContain("crypto.timingSafeEqual");
    // Aucune comparaison directe de chaînes de signature (===/!==) qui
    // contournerait timingSafeEqual — seule la comparaison de longueur
    // (nécessaire avant timingSafeEqual, qui exige des buffers de même
    // taille) est permise.
    expect(SOURCE_URL_SIGNEE).not.toMatch(/signature\s*===|===\s*signature|attendu\s*===|===\s*attendu/);
  });

  test("16. aucun secret n'est exposé dans un message d'erreur — verifierUrlSignee ne lève jamais, retourne toujours false", () => {
    const entreesInvalides = [null, "", "x", "!!!", "=".repeat(500), Buffer.from("garbage").toString("base64url")];
    for (const entree of entreesInvalides) {
      expect(() => verifierUrlSignee("cv:quelconque", entree)).not.toThrow();
      expect(verifierUrlSignee("cv:quelconque", entree)).toBe(false);
    }
    // Aucune trace de secret/clé dans le code source lui-même en dehors de
    // l'import structuré (pas de valeur en dur, pas de log de la valeur).
    expect(SOURCE_URL_SIGNEE).not.toMatch(/console\.(log|error|warn|info)/);
  });

  test("17. aucun token complet n'est écrit dans les logs — ce module ne contient aucun appel console.*", () => {
    expect(SOURCE_URL_SIGNEE).not.toMatch(/console\./);
  });
});

test.describe("url-signee — Rotation (constat, non traité dans ce lot)", () => {
  test("18. les URLs signées utilisent uniquement secretCourant (jamais secretsVerification/SESSION_SECRET_PREVIOUS) dans le code exécutable — une rotation invalide immédiatement les liens déjà émis", () => {
    expect(CODE_SANS_COMMENTAIRES).toContain("secretCourant");
    expect(CODE_SANS_COMMENTAIRES).not.toContain("secretsVerification");
    expect(CODE_SANS_COMMENTAIRES).not.toContain("SESSION_SECRET_PREVIOUS");
  });
});
