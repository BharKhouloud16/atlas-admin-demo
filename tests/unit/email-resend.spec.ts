import { test, expect } from "@playwright/test";
import type { Resend } from "resend";
import { empreinteEmail, envoyerAvecClient, masquerEmail, type ClientEnvoiEmail } from "@/lib/email";

// D6 — gestion des erreurs Resend (lib/email.ts, envoyerAvecClient).
// Fournisseur SIMULÉ : aucun réseau, aucun email réel.
//
// Contrat Resend v4 de `emails.send` : renvoie { data: { id }, error: null }
// en cas de succès, { data: null, error: { name, message } } en cas d'échec
// d'API, sans lever d'exception. Les réponses simulées sont typées à partir
// du type RÉEL exporté par le paquet `resend` installé : `npx tsc --noEmit`
// (CI) échoue si elles s'écartent de ce contrat.
type ReponseResend = Awaited<ReturnType<Resend["emails"]["send"]>>;
type ErreurResend = NonNullable<ReponseResend["error"]>;

const DESTINATAIRE = "jeanne.dupont@example.com";
const JETON = "f".repeat(64);
const LIEN = `https://atlas.exemple.test/reinitialiser-mot-de-passe?token=${JETON}`;
const PARAMS = { to: DESTINATAIRE, subject: "Atlas Quality Partners — Réinitialisation", html: `<a href="${LIEN}">lien</a>` };

function clientSimule(comportement: () => Promise<unknown>): ClientEnvoiEmail & { appels: unknown[] } {
  const appels: unknown[] = [];
  return {
    appels,
    emails: {
      send: async (p) => {
        appels.push(p);
        return comportement();
      },
    },
  };
}

function espionnerJournaux() {
  const lignes: string[] = [];
  const log = console.log;
  const error = console.error;
  const warn = console.warn;
  const capter = (...a: unknown[]) => void lignes.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  console.log = capter;
  console.error = capter;
  console.warn = capter;
  return { lignes, restaurer: () => ((console.log = log), (console.error = error), (console.warn = warn)) };
}

async function envoyer(client: ClientEnvoiEmail) {
  const espion = espionnerJournaux();
  try {
    return { resultat: await envoyerAvecClient(client, PARAMS), lignes: espion.lignes };
  } finally {
    espion.restaurer();
  }
}

function aucuneFuite(lignes: string[]) {
  const tout = lignes.join("\n");
  expect(tout).not.toContain(DESTINATAIRE);
  expect(tout).not.toContain(JETON);
  expect(tout).not.toContain("token=");
  expect(tout).not.toContain("http");
  expect(tout).not.toContain("<a ");
}

test.describe("D6 — erreurs Resend (fournisseur simulé, contrat v4)", () => {
  test("1. { data: { id }, error: null } : succès, aucun journal d'erreur", async () => {
    const reponse: ReponseResend = { data: { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }, error: null };
    const client = clientSimule(async () => reponse);
    const { resultat, lignes } = await envoyer(client);
    expect(resultat).toBe(true);
    expect(lignes).toEqual([]);
    expect(client.appels.length).toBe(1);
  });

  test("2. { data: null, error } : échec (false), journal [email:erreur] assaini", async () => {
    const erreur = { name: "validation_error", message: "The domain is not verified." } as ErreurResend;
    const reponse: ReponseResend = { data: null, error: erreur };
    const { resultat, lignes } = await envoyer(clientSimule(async () => reponse));
    expect(resultat).toBe(false);
    expect(lignes.length).toBe(1);
    expect(lignes[0]).toContain("[email:erreur]");
    expect(lignes[0]).toContain("validation_error");
    expect(lignes[0]).toContain(masquerEmail(DESTINATAIRE));
    expect(lignes[0]).toContain(empreinteEmail(DESTINATAIRE));
    expect(lignes[0]).not.toContain("domain is not verified"); // message du fournisseur jamais journalisé
    aucuneFuite(lignes);
  });

  test("3. exception levée par le client : échec (false), seul le nom de l'erreur est journalisé", async () => {
    const { resultat, lignes } = await envoyer(
      clientSimule(async () => {
        throw new TypeError(`fetch failed pour ${DESTINATAIRE} vers ${LIEN}`);
      })
    );
    expect(resultat).toBe(false);
    expect(lignes.length).toBe(1);
    expect(lignes[0]).toContain("[email:erreur]");
    expect(lignes[0]).toContain("TypeError");
    aucuneFuite(lignes);
  });

  test("4. erreur contenant des données sensibles : aucune fuite dans les journaux", async () => {
    const cas: unknown[] = [
      { data: null, error: { name: "validation_error", message: `You can only send testing emails to your own email address (${DESTINATAIRE}). ${LIEN}` } },
      { data: null, error: { name: `${LIEN} ${DESTINATAIRE}`, message: "x" } }, // nom non conforme -> « inconnue »
      { data: null, error: { name: "application_error\n[email:ok] faux journal", message: "x" } }, // tentative d'injection
      { data: null, error: { name: "rate_limit_exceeded", message: JETON, statusCode: 429, html: PARAMS.html } },
    ];
    for (const reponse of cas) {
      const { resultat, lignes } = await envoyer(clientSimule(async () => reponse));
      expect(resultat).toBe(false);
      expect(lignes.length).toBe(1);
      expect(lignes[0]).not.toContain("\n");
      expect(lignes[0]).not.toContain("[email:ok]");
      aucuneFuite(lignes);
    }
    const { lignes } = await envoyer(clientSimule(async () => cas[1]));
    expect(lignes[0]).toContain(": inconnue");
    const { lignes: avecStatut } = await envoyer(clientSimule(async () => cas[3]));
    expect(avecStatut[0]).toContain("rate_limit_exceeded (HTTP 429)");
  });

  test("5. réponse hors contrat (ni erreur ni identifiant) : jamais considérée comme un succès", async () => {
    for (const reponse of [{ data: null, error: null }, { data: {}, error: null }, { data: { id: "" }, error: null }, undefined, null]) {
      const { resultat, lignes } = await envoyer(clientSimule(async () => reponse));
      expect(resultat, JSON.stringify(reponse)).toBe(false);
      expect(lignes[0]).toContain("[email:erreur]");
      expect(lignes[0]).toContain("reponse_inattendue");
      aucuneFuite(lignes);
    }
  });

  test("le contenu transmis au fournisseur est inchangé (destinataire, sujet, HTML)", async () => {
    const client = clientSimule(async () => ({ data: { id: "x" }, error: null }));
    await envoyer(client);
    expect(client.appels[0]).toEqual({ from: (client.appels[0] as { from: string }).from, ...PARAMS });
  });
});
