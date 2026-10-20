import { test as base, expect, type APIResponse } from "@playwright/test";
import { ORIGINE_PREVIEW, enTetesBypass, estHoteAutorise } from "./cible";

// Fixtures des tests distants, ANONYMES et en LECTURE SEULE :
// - navigateur : le secret n'est ajouté qu'aux requêtes vers l'hôte Preview
//   validé (route par route). Playwright n'applique pas ces surcharges aux
//   requêtes suivant une redirection : un 3xx vers un autre domaine ne
//   reçoit donc jamais le secret. Toute autre destination part sans en-tête.
// - API : uniquement GET, chemin relatif obligatoire, aucune redirection
//   suivie (maxRedirects: 0).
type Distant = { get: (chemin: string) => Promise<APIResponse> };

export const test = base.extend<{ distant: Distant }>({
  context: async ({ context }, use) => {
    await context.route("**/*", async (route) => {
      const requete = route.request();
      if (estHoteAutorise(requete.url())) {
        await route.continue({ headers: { ...requete.headers(), ...enTetesBypass(requete.url()) } });
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
