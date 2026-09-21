import { test, expect } from "@playwright/test";
import { genererCandidatMessage, TYPES_ATTENTION_MESSAGE } from "@/lib/attention/generateurs";

// COMPANY ATLAS — V2.5 : Communication Intelligence (Lot 2, 21/09/2026).
// Fonction pure genererCandidatMessage() — aucune DB, aucun HTTP (voir
// tests/api/v25-communication-lot2.spec.ts pour le comportement HTTP/DB).

test.describe("V2.5 Lot 2 — genererCandidatMessage (pure)", () => {
  test("nonLu=false -> aucun candidat (jamais une Attention pour un fil déjà lu)", () => {
    expect(genererCandidatMessage({ clientId: "c1", recipientType: "CLIENT", recipientId: "c1", nonLu: false })).toBeNull();
  });

  test("Client non lu -> candidat type MESSAGE_NON_LU, source=Message, sourceId=clientId (règle #10)", () => {
    const candidat = genererCandidatMessage({ clientId: "c1", recipientType: "CLIENT", recipientId: "c1", nonLu: true });
    expect(candidat).not.toBeNull();
    expect(candidat!.type).toBe("MESSAGE_NON_LU");
    expect(candidat!.source).toBe("Message");
    expect(candidat!.sourceId).toBe("c1");
    expect(candidat!.recipientType).toBe("CLIENT");
    expect(candidat!.recipientId).toBe("c1");
    expect(candidat!.categorie).toBe("ACTION_REQUISE");
  });

  test("Admin non lu -> sourceId qualifié par le lecteur (\"clientId:adminUserId\"), jamais juste clientId (règle #7)", () => {
    const candidat = genererCandidatMessage({ clientId: "c1", recipientType: "ADMIN", recipientId: "admin-42", nonLu: true });
    expect(candidat).not.toBeNull();
    expect(candidat!.sourceId).toBe("c1:admin-42");
    expect(candidat!.recipientType).toBe("ADMIN");
    expect(candidat!.recipientId).toBe("admin-42");
  });

  test("deux Admins différents sur le même client -> sourceId distincts (jamais une collision de clé d'idempotence)", () => {
    const candidatA = genererCandidatMessage({ clientId: "c1", recipientType: "ADMIN", recipientId: "admin-A", nonLu: true });
    const candidatB = genererCandidatMessage({ clientId: "c1", recipientType: "ADMIN", recipientId: "admin-B", nonLu: true });
    expect(candidatA!.sourceId).not.toBe(candidatB!.sourceId);
  });

  test("TYPES_ATTENTION_MESSAGE ne contient que MESSAGE_NON_LU (fermeture volontaire pour la résolution)", () => {
    expect(TYPES_ATTENTION_MESSAGE).toEqual(["MESSAGE_NON_LU"]);
  });
});
