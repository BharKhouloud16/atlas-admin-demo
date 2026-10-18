import { test, expect } from "@playwright/test";
import { idPublicIngenieur } from "@/lib/talent/engineer-public-id";

// ATLAS LOT 15.5 — identifiant public stable de l'ingénieur (Partie H du
// mandat) : jamais l'identité réelle, toujours le même identifiant pour le
// même profil.

test.describe("idPublicIngenieur", () => {
  test("format ENG-XXXXXX", () => {
    const id = idPublicIngenieur("profil-test-1");
    expect(id).toMatch(/^ENG-[0-9A-F]{6}$/);
  });

  test("le même profilId produit toujours le même identifiant", () => {
    const a = idPublicIngenieur("profil-abc");
    const b = idPublicIngenieur("profil-abc");
    expect(a).toBe(b);
  });

  test("deux profilId différents produisent des identifiants différents", () => {
    const a = idPublicIngenieur("profil-abc");
    const b = idPublicIngenieur("profil-def");
    expect(a).not.toBe(b);
  });

  test("l'identifiant ne contient jamais le profilId original en clair", () => {
    const profilId = "cljk3v9x20001abcdefghij"; // forme réaliste d'un cuid
    const id = idPublicIngenieur(profilId);
    expect(id).not.toContain(profilId);
  });
});
