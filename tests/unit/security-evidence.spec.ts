import { test, expect } from "@playwright/test";
import {
  construireObservationSecurite,
  construireObservationsSecurite,
  grouperParDomaineSecurite,
  filtrerParStatutSecurite,
  trierParRecenceSecurite,
  contientMotifSecretSuspect,
  type EntreeObservationSecurite,
} from "@/lib/security/evidence";
import { SECURITY_DOMAINS } from "@/lib/security/domain";

// ATLAS OS SECURITY INTELLIGENCE FOUNDATION V1 (Batch 13.2) — Security
// Evidence. Tests purs (pas de DB, pas de réseau) sur
// lib/security/evidence.ts. Toujours pas d'agrégation/score/finding dans ce
// lot : uniquement construction validée (avec détection de secret) et
// organisation en lecture des observations Security — même discipline que
// tests/unit/quality-evidence.spec.ts côté B12.

function entree(overrides: Partial<EntreeObservationSecurite> = {}): EntreeObservationSecurite {
  return {
    statut: "PASS",
    label: "  Cookie de session marqué HttpOnly  ",
    preuve: "  lib/auth.ts createSession() : cookies().set(..., { httpOnly: true, ... })  ",
    source: "CODE_REVIEW",
    horodatage: new Date("2026-09-07T00:00:00Z"),
    securityDomaine: "SESSION_SECURITY",
    contexte: "  lib/auth.ts  ",
    provenanceDetail: null,
    ...overrides,
  };
}

test.describe("Security Evidence (lib/security/evidence)", () => {
  test("1. construireObservationSecurite : normalise (trim) les chaînes, force dimension SECURITY, accepte une entrée valide", () => {
    const o = construireObservationSecurite(entree());
    expect(o).not.toBeNull();
    expect(o!.dimension).toBe("SECURITY");
    expect(o!.label).toBe("Cookie de session marqué HttpOnly");
    expect(o!.contexte).toBe("lib/auth.ts");
    expect(o!.securityDomaine).toBe("SESSION_SECURITY");
    expect(o!.actif).toBeNull();
  });

  test("2. construireObservationSecurite : preuve vide après trim -> null, jamais fabriquée", () => {
    expect(construireObservationSecurite(entree({ preuve: "   " }))).toBeNull();
  });

  test("3. construireObservationSecurite : securityDomaine hors vocabulaire fermé -> null (cast forcé pour simuler une valeur corrompue)", () => {
    const corrompue = entree({ securityDomaine: "MADE_UP" as unknown as EntreeObservationSecurite["securityDomaine"] });
    expect(construireObservationSecurite(corrompue)).toBeNull();
  });

  test("4. construireObservationSecurite : actif fourni mais invalide (identifiant vide) -> null", () => {
    expect(construireObservationSecurite(entree({ actif: { type: "API", identifiant: "" } }))).toBeNull();
  });

  test("5. construireObservationSecurite : actif valide accepté et conservé tel quel", () => {
    const o = construireObservationSecurite(entree({ actif: { type: "API", identifiant: "GET /api/quality" } }));
    expect(o!.actif).toEqual({ type: "API", identifiant: "GET /api/quality" });
  });

  test("6. contientMotifSecretSuspect : détecte un jeton GitHub, une clé privée, un Bearer, une affectation password=", () => {
    expect(contientMotifSecretSuspect("token=ghp_abcdefghijklmnopqrst1234")).toBe(true);
    expect(contientMotifSecretSuspect("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(contientMotifSecretSuspect("Authorization: Bearer abcdefghij1234567890")).toBe(true);
    expect(contientMotifSecretSuspect("password: hunter2hunter2")).toBe(true);
  });

  test("7. contientMotifSecretSuspect : un texte légitime sans secret n'est jamais signalé à tort", () => {
    expect(contientMotifSecretSuspect("Cookie de session marqué HttpOnly, voir lib/auth.ts")).toBe(false);
    expect(contientMotifSecretSuspect("GET /api/quality retourne 403 pour un rôle CLIENT")).toBe(false);
  });

  test("8. construireObservationSecurite : rejette une entrée dont la preuve ressemble à un secret, jamais stockée même partiellement", () => {
    const suspecte = entree({ preuve: "Variable d'environnement lue : API_KEY=sk-abcdefghijklmnop" });
    expect(construireObservationSecurite(suspecte)).toBeNull();
  });

  test("9. construireObservationSecurite : rejette aussi si le secret apparaît dans le label ou le contexte, pas seulement la preuve", () => {
    expect(construireObservationSecurite(entree({ label: "Fuite détectée : ghp_abcdefghijklmnopqrst1234" }))).toBeNull();
    expect(construireObservationSecurite(entree({ contexte: "Bearer abcdefghij1234567890" }))).toBeNull();
  });

  test("10. construireObservationsSecurite : construit les entrées valides, compte les rejetées (invalides + suspectes), ne lève jamais d'exception", () => {
    const { observations, rejetees } = construireObservationsSecurite([
      entree(),
      entree({ preuve: "" }),
      entree({ preuve: "password: abcdefabcdef" }),
      entree({ label: "b", horodatage: new Date("2026-01-01") }),
    ]);
    expect(observations.length).toBe(2);
    expect(rejetees).toBe(2);
  });

  test("11. grouperParDomaineSecurite : les treize domaines sont toujours présents, même vides", () => {
    const { observations } = construireObservationsSecurite([entree({ securityDomaine: "AUTHENTICATION", label: "a" })]);
    const groupes = grouperParDomaineSecurite(observations);
    expect(Object.keys(groupes).sort()).toEqual([...SECURITY_DOMAINS].sort());
    expect(groupes.AUTHENTICATION.length).toBe(1);
    expect(groupes.CRYPTOGRAPHY.length).toBe(0);
  });

  test("12. grouperParDomaineSecurite : chaque observation apparaît dans son domaine exact, jamais un autre", () => {
    const { observations } = construireObservationsSecurite([
      entree({ securityDomaine: "AUTHENTICATION", label: "a" }),
      entree({ securityDomaine: "SECRETS", label: "b" }),
    ]);
    const groupes = grouperParDomaineSecurite(observations);
    expect(groupes.AUTHENTICATION.map((o) => o.label)).toEqual(["a"]);
    expect(groupes.SECRETS.map((o) => o.label)).toEqual(["b"]);
  });

  test("13. filtrerParStatutSecurite : ne retient que les statuts demandés, aucune interprétation ajoutée", () => {
    const { observations } = construireObservationsSecurite([
      entree({ statut: "PASS", label: "a" }),
      entree({ statut: "FAIL", label: "b", preuve: "echec reel documente" }),
    ]);
    expect(filtrerParStatutSecurite(observations, ["FAIL"]).map((o) => o.label)).toEqual(["b"]);
  });

  test("14. trierParRecenceSecurite : du plus récent au plus ancien, sans muter le tableau d'entrée", () => {
    const { observations } = construireObservationsSecurite([
      entree({ label: "ancien", horodatage: new Date("2026-01-01") }),
      entree({ label: "recent", horodatage: new Date("2026-09-01") }),
    ]);
    const original = [...observations];
    const tries = trierParRecenceSecurite(observations);
    expect(tries.map((o) => o.label)).toEqual(["recent", "ancien"]);
    expect(observations).toEqual(original);
  });

  test("15. déterminisme : les mêmes entrées produisent toujours le même résultat", () => {
    const entrees = [entree({ label: "a" }), entree({ label: "b", securityDomaine: "AUTHORIZATION" })];
    expect(construireObservationsSecurite(entrees)).toEqual(construireObservationsSecurite(entrees));
  });

  test("16. tableau vide : jamais un crash, résultats vides cohérents pour les treize domaines", () => {
    const { observations, rejetees } = construireObservationsSecurite([]);
    expect(observations).toEqual([]);
    expect(rejetees).toBe(0);
    const groupes = grouperParDomaineSecurite(observations);
    for (const d of SECURITY_DOMAINS) expect(groupes[d]).toEqual([]);
  });
});
