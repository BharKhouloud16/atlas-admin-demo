import { test, expect } from "@playwright/test";
import { construireMissionIntelligence, type MissionPourAnalytics, type EvaluationPourAnalytics } from "@/lib/talent/mission-intelligence";

// ATLAS TALENT — Mission Intelligence V1 (Batch 9). Tests purs (pas de DB)
// sur lib/talent/mission-intelligence.ts — complète
// tests/api/mission-intelligence.spec.ts (RBAC/isolation). Vérifie en
// particulier : STATISTIQUES/HISTORIQUE réels uniquement, jamais une
// prédiction ; une statistique sous le seuil fiable reste affichée mais
// marquée INSUFFISANTE (jamais cachée, jamais présentée comme fiable) ;
// aucune tendance sous le seuil minimal ; déterminisme strict.

test.describe("Mission Intelligence V1 (lib/talent/mission-intelligence)", () => {
  test("1. aucune mission ni évaluation : tout INSUFFISANTE/null, zones inconnues explicites, aucun crash", () => {
    const r = construireMissionIntelligence("p1", [], []);
    expect(r.activite.total).toBe(0);
    expect(r.activite.tauxReussite.valeur).toBeNull();
    expect(r.activite.tauxReussite.statut).toBe("INSUFFISANTE");
    expect(r.duree.moyenneJours.valeur).toBeNull();
    expect(r.satisfaction.moyenne.valeur).toBeNull();
    expect(r.satisfaction.tendance).toBe("INCONNUE");
    expect(r.zonesInconnues).toContain("Aucune mission enregistrée");
    expect(r.zonesInconnues).toContain("Aucune évaluation client enregistrée");
  });

  test("2. compétences utilisées : toujours vide (aucun champ équivalent sur Mission), jamais déduit du Skill Graph", () => {
    const r = construireMissionIntelligence("p2", [], []);
    expect(r.competencesUtilisees).toEqual([]);
  });

  test("3. échantillon sous le seuil fiable : la valeur réelle reste affichée mais marquée INSUFFISANTE, jamais cachée", () => {
    const missions: MissionPourAnalytics[] = [
      { statut: "Terminée", nbJours: 20, createdAt: new Date("2025-01-01") },
      { statut: "Terminée", nbJours: 30, createdAt: new Date("2025-06-01") },
    ];
    const r = construireMissionIntelligence("p3", missions, []);
    expect(r.duree.moyenneJours.valeur).toBe(25);
    expect(r.duree.moyenneJours.statut).toBe("INSUFFISANTE");
    expect(r.duree.moyenneJours.echantillon).toBe(2);
  });

  test("4. échantillon au-dessus du seuil fiable : statut SUFFISANTE", () => {
    const missions: MissionPourAnalytics[] = [
      { statut: "Terminée", nbJours: 10, createdAt: new Date("2025-01-01") },
      { statut: "Terminée", nbJours: 15, createdAt: new Date("2025-02-01") },
      { statut: "Terminée", nbJours: 20, createdAt: new Date("2025-03-01") },
    ];
    const r = construireMissionIntelligence("p4", missions, []);
    expect(r.duree.moyenneJours.statut).toBe("SUFFISANTE");
    expect(r.duree.moyenneJours.valeur).toBe(15);
    expect(r.duree.minJours).toBe(10);
    expect(r.duree.maxJours).toBe(20);
  });

  test("5. taux de réussite : missions en cours ne comptent ni pour ni contre, seules terminées/annulées entrent dans le calcul", () => {
    const missions: MissionPourAnalytics[] = [
      { statut: "Terminée", nbJours: 10, createdAt: new Date("2025-01-01") },
      { statut: "Terminée", nbJours: 10, createdAt: new Date("2025-02-01") },
      { statut: "Terminée", nbJours: 10, createdAt: new Date("2025-03-01") },
      { statut: "Annulée", nbJours: 5, createdAt: new Date("2025-04-01") },
      { statut: "Annulée", nbJours: 5, createdAt: new Date("2025-05-01") },
      { statut: "En cours", nbJours: 5, createdAt: new Date("2026-01-01") },
    ];
    const r = construireMissionIntelligence("p5", missions, []);
    expect(r.activite.tauxReussite.valeur).toBe(0.6);
    expect(r.activite.tauxReussite.echantillon).toBe(5);
    expect(r.activite.enCours).toBe(1);
  });

  test("6. aucune tendance calculée sous le seuil minimal d'évaluations, même avec un écart apparent", () => {
    const evaluations: EvaluationPourAnalytics[] = [
      { note: 1, createdAt: new Date("2025-01-01") },
      { note: 5, createdAt: new Date("2025-06-01") },
    ];
    const r = construireMissionIntelligence("p6", [], evaluations);
    expect(r.satisfaction.tendance).toBe("INCONNUE");
  });

  test("7. tendance en hausse détectée au-dessus du seuil, avec un écart significatif", () => {
    const evaluations: EvaluationPourAnalytics[] = [
      { note: 2, createdAt: new Date("2025-01-01") },
      { note: 2, createdAt: new Date("2025-02-01") },
      { note: 5, createdAt: new Date("2025-03-01") },
      { note: 5, createdAt: new Date("2025-04-01") },
    ];
    const r = construireMissionIntelligence("p7", [], evaluations);
    expect(r.satisfaction.tendance).toBe("HAUSSE");
  });

  test("8. tendance STABLE quand l'écart entre les deux moitiés reste sous le seuil significatif", () => {
    const evaluations: EvaluationPourAnalytics[] = [
      { note: 4, createdAt: new Date("2025-01-01") },
      { note: 4, createdAt: new Date("2025-02-01") },
      { note: 4, createdAt: new Date("2025-03-01") },
      { note: 4, createdAt: new Date("2025-04-01") },
    ];
    const r = construireMissionIntelligence("p8", [], evaluations);
    expect(r.satisfaction.tendance).toBe("STABLE");
  });

  test("9. déterminisme strict : même entrée -> même résultat", () => {
    const missions: MissionPourAnalytics[] = [{ statut: "Terminée", nbJours: 20, createdAt: new Date("2025-01-01") }];
    const evaluations: EvaluationPourAnalytics[] = [{ note: 4, createdAt: new Date("2025-01-01") }];
    const r1 = construireMissionIntelligence("p9", missions, evaluations);
    const r2 = construireMissionIntelligence("p9", missions, evaluations);
    expect(r1).toEqual(r2);
  });

  test("10. isolation entre profils : les statistiques d'un candidat ne contaminent jamais celles d'un autre", () => {
    const missionsA: MissionPourAnalytics[] = [
      { statut: "Terminée", nbJours: 10, createdAt: new Date("2025-01-01") },
      { statut: "Terminée", nbJours: 10, createdAt: new Date("2025-02-01") },
      { statut: "Terminée", nbJours: 10, createdAt: new Date("2025-03-01") },
    ];
    const rA = construireMissionIntelligence("pA", missionsA, []);
    const rB = construireMissionIntelligence("pB", [], []);
    expect(rA.profilId).toBe("pA");
    expect(rB.profilId).toBe("pB");
    expect(rA.activite.total).toBe(3);
    expect(rB.activite.total).toBe(0);
  });
});
