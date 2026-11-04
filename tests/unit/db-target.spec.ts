import { test, expect } from "@playwright/test";
import { identifierCibleBase, empreinteReference, EMPREINTES_CONNUES } from "@/lib/db-target";

// V1 — identification non sensible de la base ciblée (lib/db-target.ts).
// Les URL ci-dessous sont factices : aucun secret réel.
test.describe("V1 — identification de la base ciblée", () => {
  test("pooler Supabase : la référence est lue dans l'utilisateur postgres.<ref>", () => {
    const ref = "abcdefghijklmnopqrst";
    const cible = identifierCibleBase(`postgresql://postgres.${ref}:motdepasse@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`);
    expect(cible.type).toBe("supabase");
    expect(cible.empreinte).toBe(empreinteReference(ref));
  });

  test("connexion directe Supabase : la référence est lue dans l'hôte db.<ref>.supabase.co", () => {
    const ref = "tsrqponmlkjihgfedcba";
    const cible = identifierCibleBase(`postgresql://postgres:motdepasse@db.${ref}.supabase.co:5432/postgres`);
    expect(cible.type).toBe("supabase");
    expect(cible.empreinte).toBe(empreinteReference(ref));
  });

  test("le résultat ne contient jamais l'hôte, l'utilisateur, la référence ni le mot de passe", () => {
    const ref = "abcdefghijklmnopqrst";
    const serialise = JSON.stringify(
      identifierCibleBase(`postgresql://postgres.${ref}:SuperSecret123@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`)
    );
    for (const fragment of [ref, "SuperSecret123", "pooler", "postgres."]) {
      expect(serialise).not.toContain(fragment);
    }
  });

  test("base locale, absente, invalide ou autre hébergeur", () => {
    expect(identifierCibleBase("postgresql://atlas:atlas@localhost:5432/atlas_ci").type).toBe("local");
    expect(identifierCibleBase(undefined).type).toBe("absente");
    expect(identifierCibleBase("").type).toBe("absente");
    expect(identifierCibleBase("pas une url").type).toBe("invalide");
    const autre = identifierCibleBase("postgresql://u:p@db.example.org:5432/x");
    expect(autre.type).toBe("autre");
    expect(autre.libelle).toBeNull();
  });

  test("les empreintes connues sont des SHA-256 tronqués à 16 caractères hexadécimaux", () => {
    for (const empreinte of Object.keys(EMPREINTES_CONNUES)) {
      expect(empreinte).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});
