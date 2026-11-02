import { expect, type APIRequestContext, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// REV-03 (01/11/2026) — données de test ISOLÉES pour les tests des lots.
//
// Chaque test crée ses propres comptes et objets (suffixe unique) et ne
// modifie jamais les comptes de démonstration partagés (client-demo,
// ingenieur-demo, « Nouvel Ingénieur (test) »…) ni un enregistrement choisi
// au hasard (`findFirst()` sans filtre est proscrit). Ainsi l'ordre
// d'exécution et la répétition de la suite sur une même base n'ont aucun
// effet sur les autres tests. Données entièrement fictives.

export const MDP_TEST = "Demo1234";

export const QUALIFICATION = { pays: "France", contactReferent: "Mme Martin (fictive)", email: "contact@fictif.example" };
export const CONTRACTUALISATION = {
  formeJuridique: "SAS",
  identifiantEntreprise: "000 (fictif)",
  adresseSiege: "Adresse fictive",
  fonctionContact: "Directrice technique (fictive)",
};

function suffixeUnique(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
}

export async function creerClientIsole(options: { qualification?: boolean; contractualisation?: boolean; champs?: Record<string, string> } = {}) {
  const suffixe = suffixeUnique();
  const client = await prisma.client.create({
    data: {
      nom: `Client isolé ${suffixe}`,
      ...(options.qualification || options.contractualisation ? QUALIFICATION : {}),
      ...(options.contractualisation ? CONTRACTUALISATION : {}),
      ...(options.champs ?? {}),
    },
  });
  const email = `client-isole-${suffixe}@example.com`;
  await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(MDP_TEST, 4), role: "CLIENT", actif: true, clientId: client.id } });
  return { client, email, suffixe };
}

// Profil Ingénieur dédié au test (jamais un profil de démonstration).
export async function creerProfilIsole(competencesVerifiees: string[] = []) {
  const suffixe = suffixeUnique();
  return prisma.profil.create({
    data: {
      nom: `Ingénieur isolé ${suffixe}`,
      prenom: "Test",
      cvValide: true,
      competences: competencesVerifiees,
      competencesGraph: { create: competencesVerifiees.map((competence) => ({ competence, statut: "VERIFIE", confiance: "HAUTE" })) },
      seniorite: "Senior",
      anneesExperience: 6,
      disponibilite: "Disponible immédiatement",
    },
  });
}

export async function connecter(request: APIRequestContext, email: string) {
  const r = await request.post("/api/auth/login", { data: { email, password: MDP_TEST } });
  expect(r.ok(), `connexion ${email} : ${await r.text()}`).toBeTruthy();
}

// Connexion d'une page (navigateur) avec un compte isolé : le cookie de
// session posé par l'API est partagé par le contexte de la page.
export async function connecterPage(page: Page, email: string) {
  await connecter(page.request, email);
}
