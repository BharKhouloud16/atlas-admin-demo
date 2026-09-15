import { test, expect } from "@playwright/test";
import { instancesActivesParCle, valeurDejaActive, normaliserValeur } from "@/lib/client-profile/faits";

// COMPANY ATLAS — LOT 4 : Profil Client Intelligence Foundation.
// Fonction pure : supersession logique des faits répétables — une instance
// confirmée par une ligne ultérieure (confirmeDepuis) devient inactive,
// mais n'est jamais supprimée ni modifiée (historique intégralement
// additif, décision CEO LOT 4).

test.describe("COMPANY ATLAS LOT 4 — instancesActivesParCle (supersession)", () => {
  test("une seule instance, jamais confirmée -> reste active", () => {
    const faits = [{ id: "1", cle: "ENJEU", valeur: "Pénurie de talents QA", confirmeDepuis: null }];
    const actifs = instancesActivesParCle(faits);
    expect(actifs.get("ENJEU")?.map((f) => f.id)).toEqual(["1"]);
  });

  test("une instance confirmée par une ligne ultérieure -> devient inactive, jamais supprimée du tableau d'origine", () => {
    const faits = [
      { id: "1", cle: "ENJEU", valeur: "Pénurie de talents QA", confirmeDepuis: null },
      { id: "2", cle: "ENJEU", valeur: "Pénurie de talents QA", confirmeDepuis: "1" },
    ];
    const actifs = instancesActivesParCle(faits);
    expect(actifs.get("ENJEU")?.map((f) => f.id)).toEqual(["2"]);
    expect(faits.length).toBe(2); // l'historique complet reste intact
  });

  test("plusieurs instances distinctes de la même clé répétable -> toutes actives simultanément (pas de latest-wins)", () => {
    const faits = [
      { id: "1", cle: "CONTRAINTE_DURABLE", valeur: "Disponibilité stricte", confirmeDepuis: null },
      { id: "2", cle: "CONTRAINTE_DURABLE", valeur: "Budget limité", confirmeDepuis: null },
    ];
    const actifs = instancesActivesParCle(faits);
    expect(actifs.get("CONTRAINTE_DURABLE")?.map((f) => f.id).sort()).toEqual(["1", "2"]);
  });

  test("chaîne de confirmations successives -> seule la dernière de la chaîne reste active", () => {
    const faits = [
      { id: "1", cle: "ENJEU", valeur: "X", confirmeDepuis: null },
      { id: "2", cle: "ENJEU", valeur: "X", confirmeDepuis: "1" },
      { id: "3", cle: "ENJEU", valeur: "X", confirmeDepuis: "2" },
    ];
    const actifs = instancesActivesParCle(faits);
    expect(actifs.get("ENJEU")?.map((f) => f.id)).toEqual(["3"]);
  });

  test("clés distinctes -> indépendantes l'une de l'autre", () => {
    const faits = [
      { id: "1", cle: "ENJEU", valeur: "A", confirmeDepuis: null },
      { id: "2", cle: "RISQUE_DURABLE", valeur: "B", confirmeDepuis: null },
    ];
    const actifs = instancesActivesParCle(faits);
    expect(actifs.size).toBe(2);
  });
});

test.describe("COMPANY ATLAS LOT 4 — normaliserValeur / valeurDejaActive (anti-doublon)", () => {
  test("normaliserValeur : trim + casse insensible", () => {
    expect(normaliserValeur("  Pénurie de Talents QA  ")).toBe("pénurie de talents qa");
  });

  test("valeurDejaActive : une valeur identique (normalisée) déjà active -> true", () => {
    const faits = [{ id: "1", cle: "ENJEU", valeur: "  Pénurie de Talents QA ", confirmeDepuis: null }];
    expect(valeurDejaActive(faits, "ENJEU", "pénurie de talents qa")).toBe(true);
  });

  test("valeurDejaActive : une valeur superseded (inactive) -> false, jamais bloquant pour un ré-ajout", () => {
    const faits = [
      { id: "1", cle: "ENJEU", valeur: "X", confirmeDepuis: null },
      { id: "2", cle: "ENJEU", valeur: "X", confirmeDepuis: "1" },
    ];
    // "X" est actif via l'id 2 -> toujours considéré comme déjà présent
    expect(valeurDejaActive(faits, "ENJEU", "X")).toBe(true);
  });

  test("valeurDejaActive : aucune correspondance -> false", () => {
    const faits = [{ id: "1", cle: "ENJEU", valeur: "A", confirmeDepuis: null }];
    expect(valeurDejaActive(faits, "ENJEU", "B")).toBe(false);
  });
});
