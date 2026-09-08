import { test, expect } from "@playwright/test";
import { estTemplateInterneIngenieur, TEMPLATES_INTERNES_INGENIEUR } from "@/lib/security/contrats";

// ATLAS OS — TRUST & SECURITY INTELLIGENCE FOUNDATION (Batch 16, 08/09/2026).
// Verrouille le correctif "sensitive-data protection" trouvé pendant
// l'audit B16 : tjm_cout / montant_profil (coûts/rémunération internes)
// ne doivent être fournis au rendu docx QUE pour les modèles internes
// (contrat avec l'ingénieur), jamais pour les modèles client — voir
// app/api/generate-contract/route.ts et templates/README.md.
test.describe("lib/security/contrats — séparation contrats client / contrats internes", () => {
  test("cdi, freelance, portage sont des modèles internes (ingénieur)", () => {
    expect(estTemplateInterneIngenieur("cdi")).toBe(true);
    expect(estTemplateInterneIngenieur("freelance")).toBe(true);
    expect(estTemplateInterneIngenieur("portage")).toBe(true);
  });

  test("contrat_prestation et nda (destinés au client) ne sont jamais internes", () => {
    expect(estTemplateInterneIngenieur("contrat_prestation")).toBe(false);
    expect(estTemplateInterneIngenieur("nda")).toBe(false);
  });

  test("un templateKey inconnu n'est jamais traité comme interne par défaut (fail-safe)", () => {
    expect(estTemplateInterneIngenieur("nimporte_quoi")).toBe(false);
  });

  test("l'ensemble des modèles internes ne contient que les 3 contrats ingénieur, jamais les contrats client", () => {
    expect(TEMPLATES_INTERNES_INGENIEUR.has("contrat_prestation")).toBe(false);
    expect(TEMPLATES_INTERNES_INGENIEUR.has("nda")).toBe(false);
    expect(TEMPLATES_INTERNES_INGENIEUR.size).toBe(3);
  });
});
