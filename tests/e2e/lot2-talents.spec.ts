import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { creerClientIsole, connecterPage } from "../setup/donnees-isolees";

// LOT 2 (28/10/2026) — parcours Client dans l'espace Talents : profils
// proposés anonymes, comparaison côte à côte, « je souhaite poursuivre »,
// demande d'autres profils. Plus aucun second formulaire de besoin ici.
// REV-03 (01/11/2026) : client et compétence propres au test.

test("profils proposés, comparaison et poursuite depuis l'espace Talents", async ({ page }) => {
  const s = `${Date.now()}`;
  const competence = `CompE2E${s}`;
  for (const i of [1, 2]) {
    await prisma.profil.create({
      data: {
        nom: `NomE2E${s}${i}`,
        prenom: "Secret",
        cvValide: true,
        competences: [competence],
        competencesGraph: { create: [{ competence, statut: "VERIFIE", confiance: "HAUTE" }] },
        seniorite: "Senior",
        anneesExperience: 5 + i,
        tjmEstime: 600,
        disponibilite: "Disponible immédiatement",
      },
    });
  }
  const { client, email } = await creerClientIsole({ contractualisation: true });
  const titre = `Besoin talents e2e ${s}`;
  await prisma.clientNeed.create({
    data: {
      clientId: client.id,
      correlationId: `lot2-e2e-${s}`,
      titre,
      texteOriginal: titre,
      statut: "VALIDE",
      faits: { create: [{ cle: "COMPETENCE", valeur: competence, statut: "DECLARE", source: "extraction" }] },
    },
  });

  await connecterPage(page, email);
  await page.goto("/client/talent");
  const bloc = page.getByRole("region", { name: `Besoin : ${titre}` });
  await expect(bloc).toBeVisible();
  // La recherche est lancée après l'affichage (REV-02), puis les profils apparaissent.
  await expect(bloc.getByText("2 profils proposés sur 5 au plus")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Soumettre la demande")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(`NomE2E${s}`);

  const cases = bloc.getByLabel("Comparer");
  await cases.nth(0).check();
  await cases.nth(1).check();
  await expect(bloc.getByRole("table", { name: "Comparaison des profils sélectionnés" })).toBeVisible();

  await bloc.getByRole("button", { name: "Je souhaite poursuivre avec le Profil A" }).click();
  await expect(bloc.getByText(/Vous souhaitez poursuivre — transmis à l'équipe ATLAS/)).toBeVisible();

  await bloc.getByRole("button", { name: "Demander d'autres profils" }).click();
  await bloc.getByLabel(/Précisez si besoin/).fill("Profil avec expérience en recherche plein texte.");
  await bloc.getByRole("button", { name: "Envoyer la demande" }).click();
  await expect(bloc.getByText(/Demande de profils supplémentaires transmis à l'équipe ATLAS/)).toBeVisible();
});
