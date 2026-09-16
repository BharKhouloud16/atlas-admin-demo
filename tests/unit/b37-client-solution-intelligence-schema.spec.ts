import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// COMPANY ATLAS — V2.1-A (16/09/2026) : tests SCHÉMA UNIQUEMENT pour
// SolutionOption (socle data C3 Solution Intelligence). Ce fichier n'exerce
// AUCUN comportement applicatif : aucune route créée, aucune fonction
// adapterEnOptionClient()/comparerOptions() (V2.1-B), aucune décision
// (V2.1-D). Vérifie uniquement que le schéma append-only, la cardinalité
// 1 besoin -> N options, la chaîne sourceOptionId, l'intégrité des enums et
// le cascade sur ClientNeed se comportent comme conçu.

async function creerBesoinDeTest(clientId: string, suffixe: string) {
  return prisma.clientNeed.create({
    data: {
      clientId,
      correlationId: `b37-${suffixe}`,
      texteOriginal: `Besoin de test V2.1-A ${suffixe}`,
      statut: "VALIDE",
    },
  });
}

test.describe("COMPANY ATLAS V2.1-A — SolutionOption (schéma uniquement)", () => {
  test("Test 1 — une SolutionOption peut être créée pour un ClientNeed, niveau OPTION, typeSolution TALENT", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    expect(client).toBeTruthy();
    const need = await creerBesoinDeTest(client!.id, "test1");

    const option = await prisma.solutionOption.create({
      data: {
        needId: need.id,
        clientId: client!.id,
        niveau: "OPTION",
        typeSolution: "TALENT",
        titre: "Renfort compétence Kubernetes senior",
        justification: "Correspond aux compétences et au budget du besoin",
        donnees: { competencesCorrespondantes: ["Kubernetes"], niveauConfiance: "MOYENNE" },
      },
    });

    expect(option.needId).toBe(need.id);
    expect(option.clientId).toBe(client!.id);
    expect(option.niveau).toBe("OPTION");
    expect(option.typeSolution).toBe("TALENT");
    expect(option.sourceOptionId).toBeNull();
    expect(option.demandeTalentId).toBeNull();
    expect(option.decideParEmail).toBeNull();
    expect(option.decideLe).toBeNull();
  });

  test("Test 2 — un même besoin peut avoir plusieurs SolutionOption (cardinalité 1 -> N)", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerBesoinDeTest(client!.id, "test2");

    await prisma.solutionOption.create({
      data: {
        needId: need.id,
        clientId: client!.id,
        niveau: "OPTION",
        typeSolution: "TALENT",
        titre: "Option A",
        justification: "Justification A",
        donnees: {},
      },
    });
    await prisma.solutionOption.create({
      data: {
        needId: need.id,
        clientId: client!.id,
        niveau: "OPTION",
        typeSolution: "TALENT",
        titre: "Option B",
        justification: "Justification B",
        donnees: {},
      },
    });

    const options = await prisma.solutionOption.findMany({ where: { needId: need.id } });
    expect(options.length).toBe(2);
    expect(options.map((o) => o.titre).sort()).toEqual(["Option A", "Option B"]);
  });

  test("Test 3 — sourceOptionId trace la chaîne OPTION -> RECOMMANDATION -> DECISION sans jamais muter les lignes précédentes", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerBesoinDeTest(client!.id, "test3");

    const option = await prisma.solutionOption.create({
      data: {
        needId: need.id,
        clientId: client!.id,
        niveau: "OPTION",
        typeSolution: "TALENT",
        titre: "Option retenue",
        justification: "Correspond au besoin",
        donnees: {},
      },
    });

    const recommandation = await prisma.solutionOption.create({
      data: {
        needId: need.id,
        clientId: client!.id,
        niveau: "RECOMMANDATION",
        typeSolution: "TALENT",
        titre: "Option retenue",
        justification: "Meilleure correspondance parmi les options comparées",
        donnees: {},
        sourceOptionId: option.id,
      },
    });

    const decision = await prisma.solutionOption.create({
      data: {
        needId: need.id,
        clientId: client!.id,
        niveau: "DECISION",
        typeSolution: "TALENT",
        titre: "Option retenue",
        justification: "Choisie par le client",
        donnees: {},
        sourceOptionId: recommandation.id,
        decideParEmail: "client-demo@example.com",
        decideLe: new Date(),
      },
    });

    expect(recommandation.sourceOptionId).toBe(option.id);
    expect(decision.sourceOptionId).toBe(recommandation.id);

    // La ligne OPTION d'origine n'a jamais été modifiée — append-only strict.
    const optionRelue = await prisma.solutionOption.findUnique({ where: { id: option.id } });
    expect(optionRelue?.niveau).toBe("OPTION");
    expect(optionRelue?.sourceOptionId).toBeNull();

    const toutesLesLignes = await prisma.solutionOption.findMany({ where: { needId: need.id } });
    expect(toutesLesLignes.length).toBe(3);
  });

  test("Test 4 — les 6 valeurs de NiveauCertitudeSolution sont utilisables (FAIT/SIGNAL inclus, même si non produites par du code applicatif dans ce lot)", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerBesoinDeTest(client!.id, "test4");

    const niveaux = ["FAIT", "SIGNAL", "HYPOTHESE", "OPTION", "RECOMMANDATION", "DECISION"] as const;
    for (const niveau of niveaux) {
      const ligne = await prisma.solutionOption.create({
        data: {
          needId: need.id,
          clientId: client!.id,
          niveau,
          typeSolution: "TALENT",
          titre: `Ligne ${niveau}`,
          justification: "Test de valeur d'enum",
          donnees: {},
        },
      });
      expect(ligne.niveau).toBe(niveau);
    }

    const lignes = await prisma.solutionOption.findMany({ where: { needId: need.id } });
    expect(lignes.length).toBe(6);
  });

  test("Test 5 — TypeSolution n'accepte que TALENT au niveau base (SERVICE/AUTRE rejetés par la contrainte d'enum PostgreSQL)", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerBesoinDeTest(client!.id, "test5");

    let aEchoue = false;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "SolutionOption" (id, "needId", "clientId", niveau, "typeSolution", titre, justification, donnees, "createdAt")
         VALUES ('test5-invalide', $1, $2, 'OPTION', 'SERVICE', 'Titre', 'Justification', '{}'::jsonb, now())`,
        need.id,
        client!.id
      );
    } catch {
      aEchoue = true;
    }
    expect(aEchoue, "TypeSolution ne doit accepter que TALENT dans ce lot — SERVICE n'existe pas encore dans l'enum").toBe(true);

    const lignes = await prisma.solutionOption.findMany({ where: { needId: need.id } });
    expect(lignes.length).toBe(0);
  });

  test("Test 6 — la suppression d'un ClientNeed supprime en cascade ses SolutionOption (onDelete: Cascade)", async () => {
    const client = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const need = await creerBesoinDeTest(client!.id, "test6");

    const option = await prisma.solutionOption.create({
      data: {
        needId: need.id,
        clientId: client!.id,
        niveau: "OPTION",
        typeSolution: "TALENT",
        titre: "Option à supprimer en cascade",
        justification: "Test cascade",
        donnees: {},
      },
    });

    await prisma.clientNeed.delete({ where: { id: need.id } });

    const optionApresSuppression = await prisma.solutionOption.findUnique({ where: { id: option.id } });
    expect(optionApresSuppression).toBeNull();
  });

  test("Test 7 — clientId dénormalisé permet un filtrage direct sans jointure, isolé par client", async () => {
    const clientA = await prisma.client.findFirst({ where: { compte: { email: "client-demo@example.com" } } });
    const clientB = await prisma.client.findFirst({
      where: { compte: { email: { not: "client-demo@example.com" } }, id: { not: clientA!.id } },
    });
    expect(clientB, "un deuxième client de démo distinct est nécessaire pour ce test d'isolation").toBeTruthy();

    const needA = await creerBesoinDeTest(clientA!.id, "test7a");
    const needB = await creerBesoinDeTest(clientB!.id, "test7b");

    await prisma.solutionOption.create({
      data: { needId: needA.id, clientId: clientA!.id, niveau: "OPTION", typeSolution: "TALENT", titre: "A", justification: "A", donnees: {} },
    });
    await prisma.solutionOption.create({
      data: { needId: needB.id, clientId: clientB!.id, niveau: "OPTION", typeSolution: "TALENT", titre: "B", justification: "B", donnees: {} },
    });

    const optionsA = await prisma.solutionOption.findMany({ where: { clientId: clientA!.id, needId: { in: [needA.id, needB.id] } } });
    expect(optionsA.length).toBe(1);
    expect(optionsA[0].titre).toBe("A");
  });
});
