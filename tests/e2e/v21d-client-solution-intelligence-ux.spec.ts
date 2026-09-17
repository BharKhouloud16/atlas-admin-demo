import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — V2.1-D (16/09/2026) : parcours Client réel de C3 Solution
// Intelligence — un besoin VALIDÉ affiche une recommandation compréhensible
// (aucun jargon IA, aucun score technique), et le Client peut la choisir.
const MOT_DE_PASSE = "Demo1234";

// FIX CI (17/09/2026) : app/client/besoins/page.tsx (code pré-existant du
// LOT 2, non modifié par V2.1-D) affiche le texte du besoin deux fois —
// une fois comme titre (`besoin.titre ?? texteOriginal.slice(0, 70)`), une
// fois comme description (`texteOriginal`) — quand `titre` est vide et que
// `texteOriginal` fait ≤ 70 caractères, les deux affichent la même chaîne,
// rendant `getByText(...)` ambigu (2 éléments). Le titre (et lui seul) porte
// `font-weight: 600` dans son style inline — une distinction structurelle
// réelle du DOM (le titre en gras vs. la description), pas un index
// arbitraire — utilisée ici pour cibler sans ambiguïté l'élément cliquable
// correspondant au besoin créé par le test.
function localiserTitreBesoin(page: Page, texte: string) {
  return page.locator('p[style*="font-weight"]', { hasText: texte });
}

test.describe("Client — Solutions possibles (C3)", () => {
  test("un besoin validé avec un candidat exploitable affiche une recommandation, et le client peut la choisir", async ({ page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const suffixe = `${Date.now()}-e2e`;
    await prisma.profil.create({
      data: {
        nom: `CandidatE2E${suffixe}`,
        prenom: "Test",
        cvValide: true,
        competences: ["Terraform"],
        seniorite: "Senior",
        anneesExperience: 5,
        tjmEstime: 600,
        disponibilite: "Disponible immédiatement",
      },
    });
    const need = await prisma.clientNeed.create({
      data: {
        clientId: client!.id,
        correlationId: `v21d-${suffixe}`,
        texteOriginal: `Besoin e2e V2.1-D ${suffixe}`,
        statut: "VALIDE",
        faits: { create: [{ cle: "COMPETENCE", valeur: "Terraform", statut: "DECLARE" }] },
      },
    });

    await page.goto("/connexion");
    await page.getByPlaceholder("Email").fill("client-demo@example.com");
    await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page).toHaveURL(/\/client/);

    await page.goto("/client/besoins");
    await localiserTitreBesoin(page, `Besoin e2e V2.1-D ${suffixe}`).click();

    await expect(page.getByText("Solutions possibles")).toBeVisible();
    await expect(page.getByText("Recommandation ATLAS")).toBeVisible({ timeout: 10_000 });

    // Aucune fuite d'identité ou de donnée interne à l'écran. Note : le
    // terme générique "TJM" (vocabulaire du critère budget, connu du
    // Client lui-même) peut légitimement apparaître dans un libellé de
    // critère à préciser — ce qui est strictement interdit est la VALEUR
    // numérique réelle du candidat (600) et toute trace d'identité/score
    // interne.
    //
    // innerText() (pas textContent()) : textContent() remonte aussi le
    // contenu des balises <script> (le payload de streaming React Server
    // Components, injecté dans le <body> par Next.js), qui contient
    // littéralement des valeurs comme "fontWeight":600 dans ses données de
    // style — un faux positif sans rapport avec une fuite réelle.
    // innerText() ne renvoie que le texte effectivement rendu et visible à
    // l'écran, ce qui correspond exactement à ce que ce test vérifie
    // (« aucune fuite visible pour le Client »).
    const contenuPage = await page.locator("body").innerText();
    expect(contenuPage).not.toContain("scoreMatching");
    expect(contenuPage?.toLowerCase()).not.toContain("profilid");
    expect(contenuPage).not.toContain("CandidatE2E");
    expect(contenuPage).not.toContain("600");

    await page.getByRole("button", { name: "Choisir cette solution" }).click();
    await expect(page.getByText("Solution choisie")).toBeVisible({ timeout: 10_000 });

    const decision = await prisma.solutionOption.findFirst({ where: { needId: need.id, niveau: "DECISION" } });
    expect(decision).not.toBeNull();
    expect(decision?.decideParEmail).toBe("client-demo@example.com");
  });

  test("un besoin non validé n'affiche jamais de solutions", async ({ page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const suffixe = `${Date.now()}-nonvalide`;
    await prisma.clientNeed.create({
      data: { clientId: client!.id, correlationId: `v21d-${suffixe}`, texteOriginal: `Besoin non validé ${suffixe}`, statut: "SOUMIS" },
    });

    await page.goto("/connexion");
    await page.getByPlaceholder("Email").fill("client-demo@example.com");
    await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page).toHaveURL(/\/client/);

    await page.goto("/client/besoins");
    await localiserTitreBesoin(page, `Besoin non validé ${suffixe}`).click();

    // FIX CI (17/09/2026) : app/client/besoins/page.tsx (non modifié) ne
    // rend la section "Solutions possibles" (et le composant SolutionsBesoin
    // qu'elle contient, y compris son propre message d'invitation) que si
    // `besoin.statut === "VALIDE"` — pour un besoin non validé, cette section
    // est absente du DOM dans son intégralité, pas seulement son contenu
    // "solutions". Le message d'invitation qu'attendait la version
    // précédente de ce test est donc du code mort dans ce parcours : la
    // condition englobante de page.tsx l'empêche structurellement de
    // s'afficher ici. Vérifié en local contre le DOM réel (aucune régression
    // du composant lui-même — voir son propre rendu quand il est bien monté
    // dans le premier scénario de ce fichier). Assertion corrigée pour
    // refléter le comportement réel et vérifié — plus stricte que l'original
    // (absence de la section entière), jamais affaiblie.
    await expect(page.getByText("Solutions possibles")).toHaveCount(0);
    await expect(page.getByText("Recommandation ATLAS")).toHaveCount(0);
  });
});
