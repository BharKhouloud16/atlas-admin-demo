import { test as base, expect, type APIResponse } from "@playwright/test";
import { ORIGINE_PREVIEW, enTetesBypass, estHoteAutorise } from "./cible";

// Fixtures des tests distants, ANONYMES et en LECTURE SEULE :
// - navigateur : seules les requêtes vers l'hôte Preview validé sont
//   interceptées ; elles sont émises par route.fetch() SANS suivre les
//   redirections (maxRedirects: 0), puis la réponse est rendue au navigateur.
//   Vérifié localement (Playwright 1.64) : avec route.continue(), un en-tête
//   ajouté EST rejoué sur une redirection, y compris vers un autre domaine.
//   Ici, le navigateur suit lui-même chaque 3xx sans l'en-tête secret, avec
//   seulement le cookie de contournement limité à l'hôte Preview.
//   Toute autre destination part sans aucun en-tête ajouté.
// - API : uniquement GET, chemin relatif obligatoire, aucune redirection
//   suivie (maxRedirects: 0).
type Distant = { get: (chemin: string) => Promise<APIResponse> };

export const test = base.extend<{ distant: Distant }>({
  context: async ({ context }, use) => {
    await context.route("**/*", async (route) => {
      const requete = route.request();
      if (estHoteAutorise(requete.url())) {
        const reponse = await route.fetch({
          headers: { ...requete.headers(), ...enTetesBypass(requete.url(), { cookie: true }) },
          maxRedirects: 0,
        });
        await route.fulfill({ response: reponse });
      } else {
        await route.continue();
      }
    });
    await use(context);
  },

  distant: async ({ playwright }, use) => {
    const contexte = await playwright.request.newContext();
    await use({
      get: (chemin: string) => {
        if (!chemin.startsWith("/") || chemin.startsWith("//")) throw new Error(`Chemin relatif attendu : ${chemin}`);
        const url = ORIGINE_PREVIEW + chemin;
        return contexte.get(url, { headers: enTetesBypass(url), maxRedirects: 0 });
      },
    });
    await contexte.dispose();
  },
});

export { expect };
