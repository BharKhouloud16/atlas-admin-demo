import { test, expect } from "@playwright/test";
import {
  calculerSignauxRuntime,
  signalAccesRefusesRepetes,
  signalVolumeAnormal,
  signalErreursRepetees,
  signalSequenceSuspecteConnexion,
  signalAccesAnormalObjets,
  signauxSansSourceDeDonnee,
  type EvenementSecuriteAllege,
} from "@/lib/security/runtime-signals";
import { deriverRisqueInconnu, identifierRisqueManuel, construireRisquesDepuisSignaux } from "@/lib/security/runtime-risk";

// ATLAS OS — TRUST & SECURITY INTELLIGENCE FOUNDATION (Batch 16, 08/09/2026).
// Tests unitaires purs (aucune DB, aucun réseau) — même discipline que
// tests/unit/security-*.spec.ts (B13) : vocabulaire fermé, FACT -> SIGNAL
// -> RISK, jamais un raccourci UNKNOWN -> IDENTIFIED sans décision humaine.
//
// MISE À JOUR B17 (08/09/2026) — ajout de ressourceType/ressourceId au
// helper `evenement()` (directive B17 : "accès anormal à des objets" passe
// de UNKNOWN à un signal calculé, voir signalAccesAnormalObjets) et des
// tests correspondants.

const MAINTENANT = new Date("2026-09-08T12:00:00.000Z");

function evenement(partial: Partial<EvenementSecuriteAllege> & { minutesAvant?: number }): EvenementSecuriteAllege {
  const minutesAvant = partial.minutesAvant ?? 1;
  return {
    action: partial.action ?? "rbac.acces_refuse",
    resultat: partial.resultat ?? "REFUSE",
    acteurEmail: partial.acteurEmail ?? "ingenieur-demo@example.com",
    contexteIp: partial.contexteIp ?? null,
    ressourceType: partial.ressourceType ?? null,
    ressourceId: partial.ressourceId ?? null,
    createdAt: new Date(MAINTENANT.getTime() - minutesAvant * 60 * 1000),
  };
}

test.describe("lib/security/runtime-signals — accès refusés répétés", () => {
  test("aucun événement -> AUCUN_SIGNAL", () => {
    const signal = signalAccesRefusesRepetes([], MAINTENANT);
    expect(signal.statut).toBe("AUCUN_SIGNAL");
  });

  test("4 refus (sous le seuil de 5) -> AUCUN_SIGNAL", () => {
    const evenements = Array.from({ length: 4 }, () => evenement({}));
    const signal = signalAccesRefusesRepetes(evenements, MAINTENANT);
    expect(signal.statut).toBe("AUCUN_SIGNAL");
  });

  test("5 refus du même acteur en 15 minutes -> SIGNAL_DETECTE", () => {
    const evenements = Array.from({ length: 5 }, () => evenement({}));
    const signal = signalAccesRefusesRepetes(evenements, MAINTENANT);
    expect(signal.statut).toBe("SIGNAL_DETECTE");
    expect(signal.fait).toContain("ingenieur-demo@example.com");
  });

  test("5 refus mais hors fenêtre de 15 minutes -> AUCUN_SIGNAL", () => {
    const evenements = Array.from({ length: 5 }, () => evenement({ minutesAvant: 30 }));
    const signal = signalAccesRefusesRepetes(evenements, MAINTENANT);
    expect(signal.statut).toBe("AUCUN_SIGNAL");
  });

  test("5 refus répartis sur 5 acteurs différents -> AUCUN_SIGNAL (pas de faux positif agrégé)", () => {
    const evenements = ["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"].map((email) =>
      evenement({ acteurEmail: email })
    );
    const signal = signalAccesRefusesRepetes(evenements, MAINTENANT);
    expect(signal.statut).toBe("AUCUN_SIGNAL");
  });
});

test.describe("lib/security/runtime-signals — volume anormal", () => {
  test("199 événements -> AUCUN_SIGNAL, 200 -> SIGNAL_DETECTE (seuil strict)", () => {
    const sous = Array.from({ length: 199 }, () => evenement({}));
    const surSeuil = Array.from({ length: 200 }, () => evenement({}));
    expect(signalVolumeAnormal(sous, MAINTENANT).statut).toBe("AUCUN_SIGNAL");
    expect(signalVolumeAnormal(surSeuil, MAINTENANT).statut).toBe("SIGNAL_DETECTE");
  });
});

test.describe("lib/security/runtime-signals — erreurs répétées", () => {
  test("5 erreurs sur la même action -> SIGNAL_DETECTE", () => {
    const evenements = Array.from({ length: 5 }, () => evenement({ action: "contrat.generation", resultat: "ERREUR" }));
    expect(signalErreursRepetees(evenements, MAINTENANT).statut).toBe("SIGNAL_DETECTE");
  });

  test("erreurs réparties sur des actions différentes -> AUCUN_SIGNAL", () => {
    const evenements = ["a", "b", "c", "d", "e"].map((suffixe) => evenement({ action: `action.${suffixe}`, resultat: "ERREUR" }));
    expect(signalErreursRepetees(evenements, MAINTENANT).statut).toBe("AUCUN_SIGNAL");
  });
});

test.describe("lib/security/runtime-signals — séquence de connexion suspecte", () => {
  test("3 échecs puis un succès pour le même compte -> SIGNAL_DETECTE", () => {
    const evenements: EvenementSecuriteAllege[] = [
      evenement({ action: "auth.login.echec", resultat: "REFUSE", minutesAvant: 5 }),
      evenement({ action: "auth.login.echec", resultat: "REFUSE", minutesAvant: 4 }),
      evenement({ action: "auth.login.echec", resultat: "REFUSE", minutesAvant: 3 }),
      evenement({ action: "auth.login.succes", resultat: "SUCCES", minutesAvant: 1 }),
    ];
    const signal = signalSequenceSuspecteConnexion(evenements, MAINTENANT);
    expect(signal.statut).toBe("SIGNAL_DETECTE");
  });

  test("échecs sans succès -> AUCUN_SIGNAL (pas de compromission observée)", () => {
    const evenements = Array.from({ length: 5 }, () => evenement({ action: "auth.login.echec", resultat: "REFUSE" }));
    expect(signalSequenceSuspecteConnexion(evenements, MAINTENANT).statut).toBe("AUCUN_SIGNAL");
  });

  test("1 seul échec puis succès -> AUCUN_SIGNAL (sous le seuil de 3)", () => {
    const evenements: EvenementSecuriteAllege[] = [
      evenement({ action: "auth.login.echec", resultat: "REFUSE", minutesAvant: 2 }),
      evenement({ action: "auth.login.succes", resultat: "SUCCES", minutesAvant: 1 }),
    ];
    expect(signalSequenceSuspecteConnexion(evenements, MAINTENANT).statut).toBe("AUCUN_SIGNAL");
  });
});

test.describe("lib/security/runtime-signals — accès anormal à des objets (B17)", () => {
  test("aucune lecture d'objet journalisée -> AUCUN_SIGNAL (jamais UNKNOWN : la source de donnée existe désormais)", () => {
    const signal = signalAccesAnormalObjets([], MAINTENANT);
    expect(signal.statut).toBe("AUCUN_SIGNAL");
  });

  test("19 objets DISTINCTS consultés par le même acteur (sous le seuil de 20) -> AUCUN_SIGNAL", () => {
    const evenements = Array.from({ length: 19 }, (_, i) =>
      evenement({ action: "objet.consultation", resultat: "SUCCES", ressourceType: "Mission", ressourceId: `mission-${i}` })
    );
    expect(signalAccesAnormalObjets(evenements, MAINTENANT).statut).toBe("AUCUN_SIGNAL");
  });

  test("20 objets distincts consultés par le même acteur en 15 minutes -> SIGNAL_DETECTE", () => {
    const evenements = Array.from({ length: 20 }, (_, i) =>
      evenement({ action: "objet.consultation", resultat: "SUCCES", ressourceType: "Mission", ressourceId: `mission-${i}` })
    );
    const signal = signalAccesAnormalObjets(evenements, MAINTENANT);
    expect(signal.statut).toBe("SIGNAL_DETECTE");
    expect(signal.fait).toContain("ingenieur-demo@example.com");
  });

  test("50 consultations du MÊME objet -> AUCUN_SIGNAL (comptage par objet distinct, pas par volume brut)", () => {
    const evenements = Array.from({ length: 50 }, () =>
      evenement({ action: "objet.consultation", resultat: "SUCCES", ressourceType: "Mission", ressourceId: "mission-unique" })
    );
    expect(signalAccesAnormalObjets(evenements, MAINTENANT).statut).toBe("AUCUN_SIGNAL");
  });

  test("20 objets distincts mais répartis sur 20 acteurs différents -> AUCUN_SIGNAL (pas de faux positif agrégé)", () => {
    const evenements = Array.from({ length: 20 }, (_, i) =>
      evenement({
        action: "objet.consultation",
        resultat: "SUCCES",
        ressourceType: "Mission",
        ressourceId: `mission-${i}`,
        acteurEmail: `acteur-${i}@example.com`,
      })
    );
    expect(signalAccesAnormalObjets(evenements, MAINTENANT).statut).toBe("AUCUN_SIGNAL");
  });

  test("des refus RBAC (resultat REFUSE) ne comptent jamais comme des consultations", () => {
    const evenements = Array.from({ length: 25 }, (_, i) =>
      evenement({ action: "rbac.acces_refuse", resultat: "REFUSE", ressourceType: "Mission", ressourceId: `mission-${i}` })
    );
    expect(signalAccesAnormalObjets(evenements, MAINTENANT).statut).toBe("AUCUN_SIGNAL");
  });
});

test.describe("lib/security/runtime-signals — catégories sans source de donnée", () => {
  test("seul le changement de permissions reste UNKNOWN en B17 (accès objet est désormais calculé)", () => {
    const signaux = signauxSansSourceDeDonnee();
    expect(signaux).toHaveLength(1);
    expect(signaux[0].regle).toBe("changement_inhabituel_permissions");
    expect(signaux[0].statut).toBe("UNKNOWN");
  });

  test("calculerSignauxRuntime inclut les 5 règles calculées + 1 UNKNOWN, jamais moins", () => {
    const signaux = calculerSignauxRuntime([], MAINTENANT);
    expect(signaux).toHaveLength(6);
    expect(signaux.filter((s) => s.statut === "UNKNOWN")).toHaveLength(1);
    expect(signaux.some((s) => s.regle === "acces_anormal_objets")).toBe(true);
  });
});

test.describe("lib/security/runtime-risk — FACT -> SIGNAL -> RISK, jamais IDENTIFIED automatiquement", () => {
  test("un signal SIGNAL_DETECTE dérive quand même un risque UNKNOWN (jamais un raccourci)", () => {
    const signal = signalVolumeAnormal(Array.from({ length: 500 }, () => evenement({})), MAINTENANT);
    expect(signal.statut).toBe("SIGNAL_DETECTE");
    const risque = deriverRisqueInconnu(signal);
    expect(risque.niveau).toBe("UNKNOWN");
    expect(risque.risque).toBeNull();
    expect(risque.actionRecommandee).toBeNull();
  });

  test("identifierRisqueManuel exige une description et un email non vides", () => {
    const base = deriverRisqueInconnu(signalVolumeAnormal([], MAINTENANT));
    expect(() =>
      identifierRisqueManuel(base, { description: "", preuve: [], identifieParEmail: "admin-demo@example.com" })
    ).toThrow();
    expect(() =>
      identifierRisqueManuel(base, { description: "Analyse manuelle", preuve: [], identifieParEmail: "" })
    ).toThrow();
  });

  test("identifierRisqueManuel avec des valeurs valides produit un risque IDENTIFIED tracé", () => {
    const base = deriverRisqueInconnu(signalVolumeAnormal([], MAINTENANT));
    const risque = identifierRisqueManuel(base, {
      description: "Faux positif confirmé après revue manuelle des IP.",
      preuve: ["Volume dû à un test de charge planifié"],
      identifieParEmail: "admin-demo@example.com",
    });
    expect(risque.niveau).toBe("IDENTIFIED");
    expect(risque.identifieParEmail).toBe("admin-demo@example.com");
    expect(risque.identifieLe).not.toBeNull();
  });

  test("construireRisquesDepuisSignaux produit un risque par signal, tous UNKNOWN", () => {
    const signaux = calculerSignauxRuntime([], MAINTENANT);
    const risques = construireRisquesDepuisSignaux(signaux);
    expect(risques).toHaveLength(signaux.length);
    expect(risques.every((r) => r.niveau === "UNKNOWN")).toBe(true);
  });
});
