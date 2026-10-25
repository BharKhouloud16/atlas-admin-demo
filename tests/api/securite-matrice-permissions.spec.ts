import { test, expect, type APIRequestContext } from "@playwright/test";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";

// Matrice de permissions générée depuis le système de fichiers : chaque
// route de app/api et chaque méthode qu'elle exporte. Une nouvelle route est
// donc couverte automatiquement, sans liste à maintenir à la main.
//   1. Anonyme : toute route non publique refuse (401 ou 403), avant toute
//      lecture ou validation (jamais 400, 404 ni 200).
//   2. Client et Ingénieur : toute route des espaces réservés à l'Admin
//      refuse (401 ou 403).
// Identifiants de chemin fictifs : un refus d'accès ne doit pas dépendre de
// l'existence de la ressource.

type Methode = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Route = { chemin: string; methodes: Methode[] };

function routes(): Route[] {
  const racine = path.join(process.cwd(), "app", "api");
  const trouvees: Route[] = [];
  const parcourir = (dossier: string) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const complet = path.join(dossier, entree.name);
      if (entree.isDirectory()) parcourir(complet);
      else if (entree.name === "route.ts") {
        const source = fs.readFileSync(complet, "utf8");
        const methodes = Array.from(source.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)).map((m) => m[1] as Methode);
        const relatif = path.relative(racine, path.dirname(complet)).split(path.sep).join("/");
        trouvees.push({ chemin: "/api/" + relatif.replace(/\[[^\]]+\]/g, "id-fictif-matrice"), methodes });
      }
    }
  };
  parcourir(racine);
  return trouvees.sort((a, b) => a.chemin.localeCompare(b.chemin));
}

// Routes publiques par conception (chacune a ses propres tests) :
// authentification, inscription, mot de passe oublié, formulaire de
// contact, santé, taux de change, seed de démo (gardé par jeton et par
// environnement), liens de partage signés CV/vidéo.
const PUBLIQUES: Record<string, Methode[] | "toutes"> = {
  "/api/auth/login": "toutes",
  "/api/auth/logout": "toutes",
  "/api/auth/signup": "toutes",
  "/api/auth/mot-de-passe-oublie": "toutes",
  "/api/auth/reinitialiser-mot-de-passe": "toutes",
  "/api/auth/renvoyer-verification": "toutes",
  "/api/auth/verifier-email": "toutes",
  "/api/demandes-contact": ["POST"],
  "/api/sante": "toutes",
  "/api/taux-change": "toutes",
  "/api/dev-seed": "toutes",
  "/api/ingenieur/cv/fichier": "toutes",
  "/api/ingenieur/video/fichier": "toutes",
};

const ESPACES_ADMIN = [
  "/api/admin/",
  "/api/comptes",
  "/api/journal",
  "/api/security",
  "/api/control-plane/",
  "/api/strategic/",
  "/api/talent/",
  "/api/recherche",
  "/api/quality",
  "/api/ingenieurs",
  "/api/clients",
  "/api/profils/id-fictif-matrice/",
  "/api/missions/id-fictif-matrice/marge-intelligence",
];

// Routes d'un espace Admin partagées par conception avec un autre rôle,
// avec filtrage par propriétaire testé ailleurs : le Client crée et liste
// SES demandes talent (filtre clientId, testé ci-dessous).
const PARTAGEES: Record<string, Partial<Record<"CLIENT" | "INGENIEUR", Methode[]>>> = {
  "/api/talent/demandes": { CLIENT: ["GET", "POST"] },
};

function estPublique(chemin: string, methode: Methode) {
  const p = PUBLIQUES[chemin];
  return p === "toutes" || (Array.isArray(p) && p.includes(methode));
}

async function appeler(contexte: APIRequestContext, methode: Methode, chemin: string) {
  const options = methode === "GET" ? { maxRedirects: 0 } : { data: {}, maxRedirects: 0 };
  const r = await contexte.fetch(chemin, { method: methode, ...options });
  return r.status();
}

test.describe("Matrice de permissions — toutes les routes API", () => {
  test("inventaire : les routes sont bien découvertes", () => {
    const toutes = routes();
    expect(toutes.length).toBeGreaterThan(100);
    expect(toutes.every((r) => r.methodes.length > 0)).toBe(true);
  });

  test("anonyme : toute route non publique refuse l'accès (401/403)", async ({ playwright }) => {
    const anonyme = await playwright.request.newContext({ baseURL: process.env.BASE_URL ?? "http://localhost:3000" });
    const ecarts: string[] = [];
    for (const { chemin, methodes } of routes()) {
      for (const m of methodes) {
        if (estPublique(chemin, m)) continue;
        const statut = await appeler(anonyme, m, chemin);
        if (statut !== 401 && statut !== 403) ecarts.push(`${m} ${chemin} → ${statut}`);
      }
    }
    expect(ecarts).toEqual([]);
  });

  test("Client et Ingénieur : les espaces Admin refusent l'accès (401/403)", async () => {
    const clientDemo = await prisma.client.findFirstOrThrow({ where: { compte: { email: "client-demo@example.com" } } });
    const ingenieurDemo = await prisma.user.findUniqueOrThrow({ where: { email: "ingenieur-demo@example.com" } });
    const sessions = {
      CLIENT: await contexteConnecte({ email: "client-demo@example.com", role: "CLIENT", clientId: clientDemo.id }),
      INGENIEUR: await contexteConnecte({ email: "ingenieur-demo@example.com", role: "INGENIEUR", profilId: ingenieurDemo.profilId }),
    };
    const ecarts: string[] = [];
    for (const { chemin, methodes } of routes()) {
      if (!ESPACES_ADMIN.some((e) => chemin === e || chemin.startsWith(e.endsWith("/") ? e : e + "/") || chemin === e.replace(/\/$/, ""))) continue;
      for (const m of methodes) {
        for (const [role, contexte] of Object.entries(sessions)) {
          if (PARTAGEES[chemin]?.[role as "CLIENT" | "INGENIEUR"]?.includes(m)) continue;
          const statut = await appeler(contexte, m, chemin);
          if (statut !== 401 && statut !== 403) ecarts.push(`${role} ${m} ${chemin} → ${statut}`);
        }
      }
    }
    expect(ecarts).toEqual([]);
  });

  test("demandes talent partagées avec le Client : un Client ne voit jamais celles d'un autre", async () => {
    const s = `${Date.now()}`;
    const autre = await prisma.client.create({ data: { nom: `Autre client matrice ${s}` } });
    const demande = await prisma.demandeTalent.create({ data: { clientId: autre.id, description: `Demande isolée ${s}` } });
    const clientDemo = await prisma.client.findFirstOrThrow({ where: { compte: { email: "client-demo@example.com" } } });
    const client = await contexteConnecte({ email: "client-demo@example.com", role: "CLIENT", clientId: clientDemo.id });
    const r = await client.get("/api/talent/demandes");
    expect(r.status()).toBe(200);
    const texte = await r.text();
    expect(texte).not.toContain(demande.id);
    expect(texte).not.toContain(`Demande isolée ${s}`);
  });
});
