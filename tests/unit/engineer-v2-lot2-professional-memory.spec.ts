import { test, expect } from "@playwright/test";
import { construireMemoireProfessionnelle, compterMissionsAvecPreuveCompetence, type MissionPourMemoire } from "@/lib/talent/professional-memory";

// ENGINEER PROFILE V2 — Lot 2 : tests unitaires purs de
// lib/talent/professional-memory.ts (aucune base de données).

const missionReact: MissionPourMemoire = {
  id: "mission-1",
  repere: "REACT-A",
  statut: "Terminée",
  dateDebut: null,
  dateFin: null,
  evaluation: { note: 5, commentaire: "Excellent" },
};
const missionK8s: MissionPourMemoire = {
  id: "mission-2",
  repere: "K8S-B",
  statut: "Terminée",
  dateDebut: null,
  dateFin: null,
  evaluation: null,
};

test.describe("V2 Lot 2 — construireMemoireProfessionnelle", () => {
  test("regroupe les missions par compétence", () => {
    const missionsParId = new Map([
      ["mission-1", missionReact],
      ["mission-2", missionK8s],
    ]);
    const competencesParId = new Map([
      ["comp-react", "React"],
      ["comp-k8s", "Kubernetes"],
    ]);
    const liens = [
      { missionId: "mission-1", profilCompetenceId: "comp-react", creeParEmail: "admin@atlas.dev", createdAt: "2026-01-01T00:00:00Z" },
      { missionId: "mission-2", profilCompetenceId: "comp-k8s", creeParEmail: "admin@atlas.dev", createdAt: "2026-01-02T00:00:00Z" },
    ];
    const memoire = construireMemoireProfessionnelle(liens, missionsParId, competencesParId);
    expect(memoire).toHaveLength(2);
    expect(memoire.find((m) => m.competence === "React")?.missions).toEqual([missionReact]);
    expect(memoire.find((m) => m.competence === "Kubernetes")?.missions).toEqual([missionK8s]);
  });

  test("accumule plusieurs missions pour une même compétence, jamais un écrasement", () => {
    const missionsParId = new Map([
      ["mission-1", missionReact],
      ["mission-2b", { ...missionK8s, id: "mission-2b", repere: "REACT-C" }],
    ]);
    const competencesParId = new Map([["comp-react", "React"]]);
    const liens = [
      { missionId: "mission-1", profilCompetenceId: "comp-react", creeParEmail: "a@atlas.dev", createdAt: "2026-01-01T00:00:00Z" },
      { missionId: "mission-2b", profilCompetenceId: "comp-react", creeParEmail: "a@atlas.dev", createdAt: "2026-01-02T00:00:00Z" },
    ];
    const memoire = construireMemoireProfessionnelle(liens, missionsParId, competencesParId);
    expect(memoire).toHaveLength(1);
    expect(memoire[0].missions).toHaveLength(2);
  });

  test("ignore silencieusement un lien dont la mission ou la compétence n'est pas fournie (jamais un crash)", () => {
    const memoire = construireMemoireProfessionnelle(
      [{ missionId: "inconnue", profilCompetenceId: "aussi-inconnue", creeParEmail: "a@atlas.dev", createdAt: "2026-01-01T00:00:00Z" }],
      new Map(),
      new Map()
    );
    expect(memoire).toEqual([]);
  });

  test("liste vide -> résultat vide", () => {
    expect(construireMemoireProfessionnelle([], new Map(), new Map())).toEqual([]);
  });

  test("tri déterministe par nom de compétence", () => {
    const missionsParId = new Map([["m1", missionReact], ["m2", missionK8s]]);
    const competencesParId = new Map([["c1", "Zookeeper"], ["c2", "Ansible"]]);
    const liens = [
      { missionId: "m1", profilCompetenceId: "c1", creeParEmail: "a@atlas.dev", createdAt: "2026-01-01T00:00:00Z" },
      { missionId: "m2", profilCompetenceId: "c2", creeParEmail: "a@atlas.dev", createdAt: "2026-01-01T00:00:00Z" },
    ];
    const memoire = construireMemoireProfessionnelle(liens, missionsParId, competencesParId);
    expect(memoire.map((m) => m.competence)).toEqual(["Ansible", "Zookeeper"]);
  });
});

test.describe("V2 Lot 2 — compterMissionsAvecPreuveCompetence", () => {
  test("compte les missions distinctes, jamais les liens", () => {
    const liens = [
      { missionId: "m1", profilCompetenceId: "c1", creeParEmail: "a@atlas.dev", createdAt: "" },
      { missionId: "m1", profilCompetenceId: "c2", creeParEmail: "a@atlas.dev", createdAt: "" },
      { missionId: "m2", profilCompetenceId: "c1", creeParEmail: "a@atlas.dev", createdAt: "" },
    ];
    expect(compterMissionsAvecPreuveCompetence(liens)).toBe(2);
  });

  test("liste vide -> 0", () => {
    expect(compterMissionsAvecPreuveCompetence([])).toBe(0);
  });
});
