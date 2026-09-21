import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { nouveauCorrelationId } from "@/lib/security/events";
import { CLIENT_STATE } from "../setup/storage-state";

// COMPANY ATLAS — CLIENT COMPLETION PROGRAM — C10 (16/09/2026).
// "Actions requises" (app/client/page.tsx) n'agrégeait que 2 signaux
// (feuilles à valider, missions à évaluer) — ce test verrouille le signal
// ajouté "fait de profil à confirmer", déjà servi par une route existante et
// inchangée.
//
// CORRECTIF CI (21/09/2026, élargissement du correctif storageState) : le
// second signal ajouté par C10 ("besoin à clarifier") a depuis été retiré de
// "Actions requises" par la V2.3 Communication Intelligence + Attention
// Center (#46) — voir app/client/page.tsx, commentaire "la carte 'besoin à
// clarifier' a donc été retirée de Actions requises... jamais deux sections
// annonçant le même fait". Ce test asserait donc structurellement un texte
// qui ne peut plus apparaître à cet endroit — jamais un bug, un changement
// de comportement intentionnel et déjà documenté. Corrigé pour vérifier la
// migration réelle : le besoin A_CLARIFIER produit désormais une Attention
// (type BESOIN_A_CLARIFIER, source ClientNeed) via la synchronisation
// déclenchée par la page elle-même (GET /api/client/attentions, appelé par
// app/client/page.tsx) — jamais recréé manuellement ici, jamais un second
// mécanisme. Assertion plus stricte que l'originale (vérifie la vraie
// migration plutôt qu'un texte à l'ancien emplacement), jamais affaiblie.
//
// Ce test ne teste jamais le login lui-même — la connexion Client n'est
// qu'une précondition : session pré-authentifiée consommée directement (voir
// tests/setup/auth.setup.ts), 0 connexion réelle dans ce fichier, contre 1
// auparavant.
test.use({ storageState: CLIENT_STATE });

const SUFFIXE = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

test.describe("Client — Vue d'ensemble : Actions requises + centre d'Attention", () => {
  test("un fait de profil INFERE apparaît dans Actions requises ; un besoin A_CLARIFIER migre vers le centre d'Attention (V2.3), jamais dans Actions requises", async ({ page }) => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const suffixe = SUFFIXE();

    const besoin = await prisma.clientNeed.create({
      data: {
        clientId: client!.id,
        correlationId: nouveauCorrelationId(),
        titre: `Besoin C10 à clarifier ${suffixe}`,
        texteOriginal: `Besoin de test CLIENT-CONNECT C10 ${suffixe}, texte suffisamment long pour l'extraction.`,
        statut: "A_CLARIFIER",
      },
    });

    let profile = await prisma.clientProfile.findUnique({ where: { clientId: client!.id } });
    if (!profile) profile = await prisma.clientProfile.create({ data: { clientId: client!.id } });
    await prisma.clientProfileFact.create({
      data: { profileId: profile.id, cle: "ENJEU", valeur: `Enjeu déduit C10 ${suffixe}`, statut: "INFERE", source: "test" },
    });

    await page.goto("/client");
    // Attend que les fetches de la page (dont GET /api/client/attentions,
    // qui déclenche la synchronisation Billing/Besoin -> Attention) soient
    // résolus avant toute assertion — même garde que le reste de la suite.
    await expect(page.getByText(/information(s)? de profil à confirmer/i)).toBeVisible();

    // "besoin à clarifier" n'est structurellement plus jamais affiché dans
    // Actions requises depuis la V2.3 (voir commentaire ci-dessus) — jamais
    // deux sections annonçant le même fait. Scopé à la section "Actions
    // requises" elle-même (pas à la page entière) : le même besoin apparaît
    // légitimement dans la section "Attention" au-dessus (sa nouvelle
    // destination V2.3), ce qui est le comportement attendu, pas une fuite.
    const sectionActionsRequises = page.locator("section", { has: page.getByRole("heading", { name: "Actions requises", exact: true }) });
    await expect(sectionActionsRequises.getByText(new RegExp(`Besoin "${besoin.titre}"`, "i"))).toHaveCount(0);

    // La vraie migration : la synchronisation déclenchée par la page a bien
    // produit l'Attention correspondante, jamais recréée manuellement ici.
    const attentionBesoin = await prisma.attention.findFirst({
      where: { source: "ClientNeed", sourceId: besoin.id, type: "BESOIN_A_CLARIFIER" },
    });
    expect(attentionBesoin).not.toBeNull();
    expect(attentionBesoin!.categorie).toBe("ACTION_REQUISE");
  });
});
