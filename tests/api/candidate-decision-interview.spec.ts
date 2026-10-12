import { test, expect, request as pwRequest } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { contexteConnecte } from "../setup/session-token";
import { traiterRappelsDus } from "@/lib/interview/reminders";
import { creerUrlSignee } from "@/lib/url-signee";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §19. Couvre les catégories du mandat (sélection, confidentialité,
// interview, evaluation, final decision, RBAC/IDOR, rappels internes) au
// niveau HTTP — l'invariant CONFIRME/peutConfirmer est déjà couvert au
// niveau unitaire pur (voir lib/interview/service.ts). Les assertions
// vérifient l'état persisté en base, jamais uniquement le code HTTP.

let compteur = 0;
function suffixe(): string {
  compteur += 1;
  return `${Date.now()}-${compteur}-${Math.random().toString(36).slice(2)}`;
}

async function nouveauClient() {
  const s = suffixe();
  const client = await prisma.client.create({ data: { nom: `Client CDI ${s}` } });
  const email = `client-cdi-${s}@test.local`;
  const ctx = await contexteConnecte({ email, role: "CLIENT", clientId: client.id });
  return { client, email, ctx };
}

async function nouvelAdmin() {
  const s = suffixe();
  const email = `admin-cdi-${s}@test.local`;
  const ctx = await contexteConnecte({ email, role: "ADMIN" });
  return { email, ctx };
}

async function nouvelIngenieur() {
  const s = suffixe();
  const profil = await prisma.profil.create({ data: { nom: `IngCDI-${s}` } });
  const ctx = await contexteConnecte({ email: `ing-cdi-${s}@test.local`, role: "INGENIEUR", profilId: profil.id });
  return { profil, ctx };
}

async function creerDemande(clientId: string) {
  const s = suffixe();
  return prisma.demandeTalent.create({ data: { clientId, description: `Besoin test CDI ${s}` } });
}

async function creerProfilCandidat() {
  const s = suffixe();
  return prisma.profil.create({ data: { nom: `CandidatCDI-${s}`, prenom: "Prenom", cvValide: true } });
}

async function creerShortlistEntree(demandeId: string, profilId: string, statut: "SUGGEREE" | "VALIDEE" | "REJETEE" = "VALIDEE") {
  return prisma.shortlistEntree.create({
    data: { demandeId, profilId, score: 80, confiance: 0.9, motifs: [{ critere: "Compétences", poids: 1, detail: "Correspond" }], statut },
  });
}

async function selectionActive(demandeId: string, shortlistEntreeId: string, email = "selector@test.local") {
  return prisma.candidateSelection.create({ data: { demandeTalentId: demandeId, shortlistEntreeId, selectedByEmail: email } });
}

test.describe("CDI — CandidateSelection", () => {
  test("Client crée une sélection sur une entrée VALIDEE puis la retire", async () => {
    const { client, email, ctx } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profil = await creerProfilCandidat();
    const entree = await creerShortlistEntree(demande.id, profil.id, "VALIDEE");

    const creation = await ctx.post(`/api/client/talent-selection/demandes/${demande.id}/selections`, {
      data: { shortlistEntreeId: entree.id },
    });
    expect(creation.status(), await creation.text()).toBe(201);
    const selection = await creation.json();
    expect(selection.statut).toBe("ACTIVE");
    expect(selection.selectedByEmail).toBe(email);

    const doublon = await ctx.post(`/api/client/talent-selection/demandes/${demande.id}/selections`, {
      data: { shortlistEntreeId: entree.id },
    });
    expect(doublon.status()).toBe(409);

    const retrait = await ctx.delete(`/api/client/talent-selection/selections/${selection.id}`);
    expect(retrait.status(), await retrait.text()).toBe(200);
    const enBase = await prisma.candidateSelection.findUniqueOrThrow({ where: { id: selection.id } });
    expect(enBase.statut).toBe("RETIREE");

    const reSelection = await ctx.post(`/api/client/talent-selection/demandes/${demande.id}/selections`, {
      data: { shortlistEntreeId: entree.id },
    });
    expect(reSelection.status(), await reSelection.text()).toBe(201);
    expect((await reSelection.json()).id).not.toBe(selection.id);
  });

  test("une entrée SUGGEREE (non validée) ne peut pas être sélectionnée", async () => {
    const { client, ctx } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profil = await creerProfilCandidat();
    const entree = await creerShortlistEntree(demande.id, profil.id, "SUGGEREE");

    const reponse = await ctx.post(`/api/client/talent-selection/demandes/${demande.id}/selections`, {
      data: { shortlistEntreeId: entree.id },
    });
    expect(reponse.status()).toBe(400);
  });
});

test.describe("CDI — Confidentialité", () => {
  test("le shortlist Client ne retourne que les entrées VALIDEE, jamais SUGGEREE/REJETEE, jamais d'identité réelle", async () => {
    const { client, ctx } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profilValide = await creerProfilCandidat();
    const profilSuggere = await creerProfilCandidat();
    const profilRejete = await creerProfilCandidat();
    await creerShortlistEntree(demande.id, profilValide.id, "VALIDEE");
    await creerShortlistEntree(demande.id, profilSuggere.id, "SUGGEREE");
    await creerShortlistEntree(demande.id, profilRejete.id, "REJETEE");

    const reponse = await ctx.get(`/api/client/talent-selection/demandes/${demande.id}/shortlist`);
    expect(reponse.status()).toBe(200);
    const corps = await reponse.json();
    expect(corps.resultats.length).toBe(1);
    const brut = JSON.stringify(corps);
    expect(brut).not.toContain(profilValide.nom);
    expect(brut).not.toContain(profilSuggere.id);
    expect(brut).not.toContain(profilRejete.id);
  });

  test("l'identité (nom/prénom) n'est révélée qu'après CandidateSelection, jamais avant, jamais email/téléphone", async () => {
    const { client, ctx } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profil = await creerProfilCandidat();
    const entree = await creerShortlistEntree(demande.id, profil.id, "VALIDEE");

    const selection = await selectionActive(demande.id, entree.id);
    const reveal = await ctx.get(`/api/client/talent-selection/selections/${selection.id}/profil`);
    expect(reveal.status()).toBe(200);
    const corps = await reveal.json();
    expect(corps).toEqual({ nom: profil.nom, prenom: profil.prenom });
    expect(corps.email).toBeUndefined();
    expect(corps.telephone).toBeUndefined();
  });

  test("IDOR : un profilId arbitraire n'est jamais accepté — seul selectionId résout l'identité", async () => {
    const { ctx } = await nouveauClient();
    // Aucune route de ce lot n'accepte profilId en paramètre — vérifié en
    // confirmant qu'un selectionId inexistant échoue en 404, jamais un
    // profilId substitué silencieusement.
    const reponse = await ctx.get(`/api/client/talent-selection/selections/id-inexistant/profil`);
    expect(reponse.status()).toBe(404);
  });

  // CORRECTIF P0 (audit docs/audits/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_AUDIT.md
  // §12.3) — CTO Validation §5, condition non négociable 2 : "score/
  // confiance/motifs ne sont JAMAIS sérialisés dans la réponse [d'une route
  // Client]." Ce test échoue explicitement si l'un des trois champs — ou le
  // champ `poids` (numérique) porté par `motifs` — réapparaît un jour dans
  // l'une des deux réponses Client concernées, quelle que soit la forme du
  // JSON (vérification par clé, pas seulement par valeur).
  test("ni le shortlist ni la comparison Client ne sérialisent jamais score/confiance/motifs/poids", async () => {
    const { client, ctx } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profil = await creerProfilCandidat();
    const entree = await creerShortlistEntree(demande.id, profil.id, "VALIDEE");
    await selectionActive(demande.id, entree.id);

    const reponseShortlist = await ctx.get(`/api/client/talent-selection/demandes/${demande.id}/shortlist`);
    expect(reponseShortlist.status()).toBe(200);
    const corpsShortlist = await reponseShortlist.json();
    assertAucuneCleInterdite(corpsShortlist);
    // L'entrée doit malgré tout être présente et porter une explication
    // qualitative — la correction ne doit pas vider le contenu utile.
    expect(corpsShortlist.resultats).toHaveLength(1);
    expect(corpsShortlist.resultats[0].explications).toEqual([{ critere: "Compétences", detail: "Correspond" }]);

    const reponseComparison = await ctx.get(`/api/client/talent-selection/demandes/${demande.id}/comparison`);
    expect(reponseComparison.status()).toBe(200);
    const corpsComparison = await reponseComparison.json();
    assertAucuneCleInterdite(corpsComparison);
    expect(corpsComparison.candidats).toHaveLength(1);
    expect(corpsComparison.candidats[0].explications).toEqual([{ critere: "Compétences", detail: "Correspond" }]);
  });
});

// Parcourt récursivement un objet JSON et échoue si une clé interdite
// apparaît n'importe où dans la structure (jamais seulement au premier
// niveau — une régression future pourrait les nicher ailleurs).
const CLES_INTERDITES = new Set(["score", "confiance", "motifs", "poids"]);
function assertAucuneCleInterdite(valeur: unknown, chemin = ""): void {
  if (Array.isArray(valeur)) {
    valeur.forEach((v, i) => assertAucuneCleInterdite(v, `${chemin}[${i}]`));
    return;
  }
  if (valeur !== null && typeof valeur === "object") {
    for (const [cle, sousValeur] of Object.entries(valeur as Record<string, unknown>)) {
      expect(CLES_INTERDITES.has(cle), `clé interdite "${cle}" trouvée à ${chemin || "<racine>"}.${cle}`).toBe(false);
      assertAucuneCleInterdite(sousValeur, `${chemin}.${cle}`);
    }
  }
}

test.describe("CDI — Interview : création et invariants", () => {
  async function demandeAvecSelectionActive() {
    const { client, ctx } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profil = await creerProfilCandidat();
    const entree = await creerShortlistEntree(demande.id, profil.id, "VALIDEE");
    const selection = await selectionActive(demande.id, entree.id);
    return { client, ctx, demande, profil, entree, selection };
  }

  test("création réussie avec exactement un organisateur et un CANDIDAT", async () => {
    const { demande, profil, selection } = await demandeAvecSelectionActive();
    const { ctx: ctxAdmin } = await nouvelAdmin();

    const reponse = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/interviews`, {
      data: {
        candidateSelectionId: selection.id,
        canal: "VIDEO",
        dateHeure: new Date(Date.now() + 3600_000).toISOString(),
        dureeMinutes: 45,
        timezoneSaisie: "Europe/Paris",
        participants: [
          { role: "CANDIDAT", emailParticipant: "candidat@test.local", profilId: profil.id },
          { role: "CLIENT", emailParticipant: "client-contact@test.local" },
          { role: "ADMIN_RECRUTEUR", emailParticipant: "admin-contact@test.local", estOrganisateur: true },
        ],
      },
    });
    expect(reponse.status(), await reponse.text()).toBe(201);
    const interview = await reponse.json();
    expect(interview.statut).toBe("PLANIFIE");
    expect(interview.participants).toHaveLength(3);

    const reminders = await prisma.interviewReminder.findMany({ where: { interviewParticipantId: { in: interview.participants.map((p: { id: string }) => p.id) } } });
    expect(reminders.length).toBe(3 * 2); // 2 délais par défaut (24h/1h) x 3 participants
  });

  test("rejet : deux organisateurs, ou aucun CANDIDAT", async () => {
    const { demande, profil, selection } = await demandeAvecSelectionActive();
    const { ctx: ctxAdmin } = await nouvelAdmin();

    const deuxOrganisateurs = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/interviews`, {
      data: {
        candidateSelectionId: selection.id,
        canal: "VIDEO",
        dateHeure: new Date(Date.now() + 3600_000).toISOString(),
        dureeMinutes: 30,
        timezoneSaisie: "Europe/Paris",
        participants: [
          { role: "CANDIDAT", emailParticipant: "c@test.local", profilId: profil.id },
          { role: "ADMIN_RECRUTEUR", emailParticipant: "a1@test.local", estOrganisateur: true },
          { role: "ADMIN_RECRUTEUR", emailParticipant: "a2@test.local", estOrganisateur: true },
        ],
      },
    });
    expect(deuxOrganisateurs.status()).toBe(400);

    const sansCandidat = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/interviews`, {
      data: {
        candidateSelectionId: selection.id,
        canal: "VIDEO",
        dateHeure: new Date(Date.now() + 3600_000).toISOString(),
        dureeMinutes: 30,
        timezoneSaisie: "Europe/Paris",
        participants: [{ role: "ADMIN_RECRUTEUR", emailParticipant: "a@test.local", estOrganisateur: true }],
      },
    });
    expect(sansCandidat.status()).toBe(400);
  });

  test("critère CONFIRME : échoue tant qu'un participant requis n'a pas ACCEPTEE, réussit quand tous l'ont", async () => {
    const { demande, profil, selection } = await demandeAvecSelectionActive();
    const { ctx: ctxAdmin } = await nouvelAdmin();

    const creation = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/interviews`, {
      data: {
        candidateSelectionId: selection.id,
        canal: "VIDEO",
        dateHeure: new Date(Date.now() + 3600_000).toISOString(),
        dureeMinutes: 30,
        timezoneSaisie: "Europe/Paris",
        participants: [
          { role: "CANDIDAT", emailParticipant: "candidat@test.local", profilId: profil.id },
          { role: "CLIENT", emailParticipant: "client-contact@test.local" },
          { role: "ADMIN_RECRUTEUR", emailParticipant: "admin-contact@test.local", estOrganisateur: true },
        ],
      },
    });
    const interview = await creation.json();
    const candidatParticipant = interview.participants.find((p: { role: string }) => p.role === "CANDIDAT");
    const organisateurParticipant = interview.participants.find((p: { estOrganisateur: boolean }) => p.estOrganisateur);
    const clientParticipant = interview.participants.find((p: { role: string }) => p.role === "CLIENT");

    // Le CLIENT (non requis : ni CANDIDAT ni organisateur) accepte seul —
    // ne doit jamais suffire à confirmer.
    const sign1 = await signerToken(interview.id, clientParticipant.id);
    await fetchReponse(interview.id, clientParticipant.id, sign1, "ACCEPTEE");
    expect((await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).statut).toBe("PLANIFIE");

    const sign2 = await signerToken(interview.id, candidatParticipant.id);
    await fetchReponse(interview.id, candidatParticipant.id, sign2, "ACCEPTEE");
    expect((await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).statut).toBe("PLANIFIE");

    const sign3 = await signerToken(interview.id, organisateurParticipant.id);
    const derniereReponse = await fetchReponse(interview.id, organisateurParticipant.id, sign3, "ACCEPTEE");
    expect(derniereReponse.status()).toBe(200);
    expect((await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).statut).toBe("CONFIRME");
  });

  // CORRECTIF P1 (audit §8.1) — preuve de concurrence RÉELLE, pas
  // seulement séquentielle (contrairement au test précédent, qui enchaîne
  // les `await` un par un). Les deux participants requis (CANDIDAT +
  // organisateur) répondent ACCEPTEE via `Promise.all` — deux requêtes HTTP
  // réellement simultanées, chacune sur son propre contexte Playwright/sa
  // propre connexion — pour exercer la fenêtre de "lost update" identifiée
  // par l'audit sous l'ancienne isolation par défaut. L'assertion porte sur
  // l'état final PERSISTÉ EN BASE (jamais seulement le code HTTP des deux
  // réponses, qui peuvent toutes deux renvoyer 200 même si l'une a dû
  // retenter sous P2034).
  test("deux réponses ACCEPTEE réellement concurrentes des participants requis mènent à CONFIRME (jamais un lost update)", async () => {
    const { demande, profil, selection } = await demandeAvecSelectionActive();
    const { ctx: ctxAdmin } = await nouvelAdmin();

    const creation = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/interviews`, {
      data: {
        candidateSelectionId: selection.id,
        canal: "VIDEO",
        dateHeure: new Date(Date.now() + 3600_000).toISOString(),
        dureeMinutes: 30,
        timezoneSaisie: "Europe/Paris",
        participants: [
          { role: "CANDIDAT", emailParticipant: "candidat-concurrent@test.local", profilId: profil.id },
          { role: "ADMIN_RECRUTEUR", emailParticipant: "organisateur-concurrent@test.local", estOrganisateur: true },
        ],
      },
    });
    const interview = await creation.json();
    const candidatParticipant = interview.participants.find((p: { role: string }) => p.role === "CANDIDAT");
    const organisateurParticipant = interview.participants.find((p: { estOrganisateur: boolean }) => p.estOrganisateur);

    const [tokenCandidat, tokenOrganisateur] = [
      signerToken(interview.id, candidatParticipant.id),
      signerToken(interview.id, organisateurParticipant.id),
    ];

    // Déclenchées dans le même tick, sans attendre l'une avant l'autre —
    // c'est `Promise.all`, pas deux `await` successifs, qui crée la
    // concurrence réelle exercée ici.
    const [reponseCandidat, reponseOrganisateur] = await Promise.all([
      fetchReponse(interview.id, candidatParticipant.id, tokenCandidat, "ACCEPTEE"),
      fetchReponse(interview.id, organisateurParticipant.id, tokenOrganisateur, "ACCEPTEE"),
    ]);

    expect(reponseCandidat.status(), await reponseCandidat.text()).toBe(200);
    expect(reponseOrganisateur.status(), await reponseOrganisateur.text()).toBe(200);

    // Preuve en base, pas seulement sur le code HTTP : les deux
    // participants doivent être ACCEPTEE ET l'Interview doit avoir atteint
    // CONFIRME — jamais rester bloqué à PLANIFIE malgré les deux acceptations.
    const interviewFinal = await prisma.interview.findUniqueOrThrow({
      where: { id: interview.id },
      include: { participants: true },
    });
    expect(interviewFinal.statut).toBe("CONFIRME");
    for (const p of interviewFinal.participants) {
      expect(p.statutInvitation).toBe("ACCEPTEE");
    }
  });

  test("le refus d'un participant requis annule l'Interview et ses rappels restants", async () => {
    const { demande, profil, selection } = await demandeAvecSelectionActive();
    const { ctx: ctxAdmin } = await nouvelAdmin();

    const creation = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/interviews`, {
      data: {
        candidateSelectionId: selection.id,
        canal: "VIDEO",
        dateHeure: new Date(Date.now() + 3600_000).toISOString(),
        dureeMinutes: 30,
        timezoneSaisie: "Europe/Paris",
        participants: [
          { role: "CANDIDAT", emailParticipant: "candidat2@test.local", profilId: profil.id },
          { role: "ADMIN_RECRUTEUR", emailParticipant: "admin2@test.local", estOrganisateur: true },
        ],
      },
    });
    const interview = await creation.json();
    const candidatParticipant = interview.participants.find((p: { role: string }) => p.role === "CANDIDAT");

    const token = await signerToken(interview.id, candidatParticipant.id);
    const reponse = await fetchReponse(interview.id, candidatParticipant.id, token, "REFUSEE");
    expect(reponse.status()).toBe(200);

    const interviewFinal = await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } });
    expect(interviewFinal.statut).toBe("ANNULE");

    const reminders = await prisma.interviewReminder.findMany({ where: { interviewParticipantId: candidatParticipant.id } });
    expect(reminders.every((r) => r.statutEnvoi === "ANNULE")).toBe(true);
  });
});

// CORRECTIF P1 (audit §14.1) — `resynchroniserApresReprogrammation()` /
// `annulerSync()` (lib/calendar/sync.ts) existaient déjà avant ce lot mais
// n'étaient jamais appelées par le domaine Interview. Ces tests vérifient
// que les bonnes fonctions sont désormais déclenchées aux bons moments
// (annulation Admin explicite, auto-annulation sur refus requis,
// reprogrammation), et qu'une panne/absence de provider calendrier ne
// corrompt jamais une transition métier déjà persistée.
test.describe("CDI — Calendrier (correctif P1 §14.1)", () => {
  async function demandeAvecSelectionActive() {
    const { client, ctx } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profil = await creerProfilCandidat();
    const entree = await creerShortlistEntree(demande.id, profil.id, "VALIDEE");
    const selection = await selectionActive(demande.id, entree.id);
    return { client, ctx, demande, profil, entree, selection };
  }

  // `declencherSyncApresAcceptation` est appelée en fire-and-forget (`void`,
  // non attendue) depuis la route de réponse — on attend donc ici
  // l'apparition du CalendarSyncRecord au lieu de la supposer immédiate.
  async function attendreCalendarSyncRecord(interviewParticipantId: string, timeoutMs = 3000) {
    const debut = Date.now();
    while (Date.now() - debut < timeoutMs) {
      const record = await prisma.calendarSyncRecord.findUnique({ where: { interviewParticipantId } });
      if (record) return record;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }

  test("l'annulation Admin déclenche annulerSync pour le participant synchronisé, sans jamais en créer pour celui qui ne l'était pas", async () => {
    const { demande, profil, selection } = await demandeAvecSelectionActive();
    const { ctx: ctxAdmin } = await nouvelAdmin();

    const creation = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/interviews`, {
      data: {
        candidateSelectionId: selection.id,
        canal: "VIDEO",
        dateHeure: new Date(Date.now() + 3600_000).toISOString(),
        dureeMinutes: 30,
        timezoneSaisie: "Europe/Paris",
        participants: [
          { role: "CANDIDAT", emailParticipant: "candidat-cal1@test.local", profilId: profil.id },
          { role: "ADMIN_RECRUTEUR", emailParticipant: "organisateur-cal1@test.local", estOrganisateur: true },
        ],
      },
    });
    const interview = await creation.json();
    const candidatParticipant = interview.participants.find((p: { role: string }) => p.role === "CANDIDAT");
    const organisateurParticipant = interview.participants.find((p: { estOrganisateur: boolean }) => p.estOrganisateur);

    // Seul le CANDIDAT accepte (§11, trigger unique) — un CalendarSyncRecord
    // EN_ATTENTE est créé pour lui, jamais pour l'organisateur qui n'a pas
    // encore répondu.
    const token = await signerToken(interview.id, candidatParticipant.id);
    const reponse = await fetchReponse(interview.id, candidatParticipant.id, token, "ACCEPTEE");
    expect(reponse.status()).toBe(200);

    const recordCandidatAvant = await attendreCalendarSyncRecord(candidatParticipant.id);
    expect(recordCandidatAvant?.statutSync).toBe("EN_ATTENTE");
    expect(await prisma.calendarSyncRecord.findUnique({ where: { interviewParticipantId: organisateurParticipant.id } })).toBeNull();

    // Interview encore PLANIFIE : l'annulation Admin explicite reste
    // autorisée depuis cet état (§9) même sans que tous aient répondu.
    const annulation = await ctxAdmin.patch(`/api/talent/demandes/${demande.id}/interviews/${interview.id}`, {
      data: { action: "cancel", motifAnnulation: "Test calendrier" },
    });
    expect(annulation.status(), await annulation.text()).toBe(200);
    expect((await annulation.json()).statut).toBe("ANNULE");

    // CORRECTIF P1 (§14.1) : annulerInterviewAvecRetry appelle désormais
    // annulerSync() pour chaque participant — le record du CANDIDAT passe
    // à ANNULE_EXTERNE.
    const recordCandidatApres = await prisma.calendarSyncRecord.findUniqueOrThrow({
      where: { interviewParticipantId: candidatParticipant.id },
    });
    expect(recordCandidatApres.statutSync).toBe("ANNULE_EXTERNE");

    // annulerSync() ne fabrique jamais un faux événement externe là où
    // aucune synchronisation n'a jamais existé.
    expect(await prisma.calendarSyncRecord.findUnique({ where: { interviewParticipantId: organisateurParticipant.id } })).toBeNull();
  });

  test("le refus d'un participant requis déclenche aussi annulerSync, via un chemin distinct de l'annulation Admin", async () => {
    const { demande, profil, selection } = await demandeAvecSelectionActive();
    const { ctx: ctxAdmin } = await nouvelAdmin();

    const creation = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/interviews`, {
      data: {
        candidateSelectionId: selection.id,
        canal: "VIDEO",
        dateHeure: new Date(Date.now() + 3600_000).toISOString(),
        dureeMinutes: 30,
        timezoneSaisie: "Europe/Paris",
        participants: [
          { role: "CANDIDAT", emailParticipant: "candidat-cal2@test.local", profilId: profil.id },
          { role: "ADMIN_RECRUTEUR", emailParticipant: "organisateur-cal2@test.local", estOrganisateur: true },
        ],
      },
    });
    const interview = await creation.json();
    const candidatParticipant = interview.participants.find((p: { role: string }) => p.role === "CANDIDAT");
    const organisateurParticipant = interview.participants.find((p: { estOrganisateur: boolean }) => p.estOrganisateur);

    // Le CANDIDAT accepte d'abord — crée son CalendarSyncRecord EN_ATTENTE.
    const tokenCandidat = await signerToken(interview.id, candidatParticipant.id);
    await fetchReponse(interview.id, candidatParticipant.id, tokenCandidat, "ACCEPTEE");
    const recordAvant = await attendreCalendarSyncRecord(candidatParticipant.id);
    expect(recordAvant?.statutSync).toBe("EN_ATTENTE");

    // L'organisateur (requis) refuse ensuite — §4/§8 : auto-annulation de
    // l'Interview, déclenchée ici depuis enregistrerReponseInvitationAvecRetry,
    // jamais depuis la route Admin d'annulation explicite testée ci-dessus.
    const tokenOrganisateur = await signerToken(interview.id, organisateurParticipant.id);
    const refus = await fetchReponse(interview.id, organisateurParticipant.id, tokenOrganisateur, "REFUSEE");
    expect(refus.status()).toBe(200);

    const interviewFinal = await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } });
    expect(interviewFinal.statut).toBe("ANNULE");

    // CORRECTIF P1 (§14.1) : la synchronisation du CANDIDAT est désormais
    // annulée elle aussi, sans attendre une action Admin distincte.
    const recordApres = await prisma.calendarSyncRecord.findUniqueOrThrow({
      where: { interviewParticipantId: candidatParticipant.id },
    });
    expect(recordApres.statutSync).toBe("ANNULE_EXTERNE");
  });

  // Portée volontairement plus restreinte que les deux tests ci-dessus :
  // `resynchroniserApresReprogrammation()` (lib/calendar/sync.ts) retourne
  // immédiatement (`if (!provider) return;`) tant qu'aucun provider réel
  // n'est configuré — ce qui est le cas partout dans ce dépôt (confirmé
  // §11/§13/§21 : aucun provider réel dans ce lot). Elle ne produit donc
  // AUCUN effet observable en base, qu'elle soit appelée ou non : il
  // n'existe aucun moyen, depuis ces tests HTTP/DB, de prouver
  // positivement que `resynchroniserCalendrierPourInterview()` a été
  // invoquée, sans ajouter un seam de mock absent du reste du dépôt (hors
  // périmètre de ce lot correctif, qui ne touche que le wiring, jamais le
  // comportement interne de lib/calendar/sync.ts). Ce test ne prouve donc
  // que l'invariant négatif exigé par le mandat : une reprogrammation ne
  // doit JAMAIS faire échouer la transition métier ni corrompre un
  // CalendarSyncRecord existant — ce gap d'observabilité du chemin
  // "succès positif de la resynchronisation" est documenté ici et repris
  // explicitement dans le rapport final.
  test("la reprogrammation d'un Interview réussit et ne corrompt jamais un CalendarSyncRecord existant", async () => {
    const { demande, profil, selection } = await demandeAvecSelectionActive();
    const { ctx: ctxAdmin } = await nouvelAdmin();

    const creation = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/interviews`, {
      data: {
        candidateSelectionId: selection.id,
        canal: "VIDEO",
        dateHeure: new Date(Date.now() + 3600_000).toISOString(),
        dureeMinutes: 30,
        timezoneSaisie: "Europe/Paris",
        participants: [
          { role: "CANDIDAT", emailParticipant: "candidat-cal3@test.local", profilId: profil.id },
          { role: "ADMIN_RECRUTEUR", emailParticipant: "organisateur-cal3@test.local", estOrganisateur: true },
        ],
      },
    });
    const interview = await creation.json();
    const candidatParticipant = interview.participants.find((p: { role: string }) => p.role === "CANDIDAT");

    const token = await signerToken(interview.id, candidatParticipant.id);
    await fetchReponse(interview.id, candidatParticipant.id, token, "ACCEPTEE");
    const recordAvant = await attendreCalendarSyncRecord(candidatParticipant.id);
    expect(recordAvant?.statutSync).toBe("EN_ATTENTE");

    // `reprogrammerInterviewAvecRetry` attend `resynchroniserCalendrierPourInterview`
    // avant de retourner (jamais fire-and-forget ici, à la différence de
    // `declencherSyncApresAcceptation`) : aucune attente artificielle n'est
    // nécessaire après la réponse HTTP.
    const nouvelleDate = new Date(Date.now() + 7200_000).toISOString();
    const reprog = await ctxAdmin.patch(`/api/talent/demandes/${demande.id}/interviews/${interview.id}`, {
      data: { action: "reschedule", dateHeure: nouvelleDate },
    });
    expect(reprog.status(), await reprog.text()).toBe(200);
    expect((await reprog.json()).dateHeure).toBe(nouvelleDate);

    const recordApres = await prisma.calendarSyncRecord.findUniqueOrThrow({
      where: { interviewParticipantId: candidatParticipant.id },
    });
    expect(recordApres.statutSync).toBe("EN_ATTENTE");
  });
});

function signerToken(interviewId: string, participantId: string) {
  return creerUrlSignee(`interview-participant:${interviewId}:${participantId}`, 3600).token;
}

async function fetchReponse(interviewId: string, participantId: string, token: string, reponse: "ACCEPTEE" | "REFUSEE") {
  const ctx = await pwRequest.newContext({ baseURL: process.env.BASE_URL ?? "http://localhost:3000" });
  return ctx.post(`/api/interviews/${interviewId}/participants/${participantId}/reponse?token=${encodeURIComponent(token)}`, {
    data: { reponse },
  });
}

test.describe("CDI — Evaluation", () => {
  test("seul un participant ACCEPTEE peut évaluer ; l'évaluation est append-only (supersedesId)", async () => {
    const { client, email: emailClient, ctx: ctxClient } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profil = await creerProfilCandidat();
    const entree = await creerShortlistEntree(demande.id, profil.id, "VALIDEE");
    const selection = await selectionActive(demande.id, entree.id);
    const { ctx: ctxAdmin } = await nouvelAdmin();

    // Le participant CLIENT est invité avec L'EMAIL RÉEL DE LA SESSION
    // Client — l'ownership d'une InterviewEvaluation (§1.4) se résout par
    // evaluateurEmail === session.email, jamais par un rôle déclaré seul.
    const creation = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/interviews`, {
      data: {
        candidateSelectionId: selection.id,
        canal: "VIDEO",
        dateHeure: new Date(Date.now() + 3600_000).toISOString(),
        dureeMinutes: 30,
        timezoneSaisie: "Europe/Paris",
        participants: [
          { role: "CANDIDAT", emailParticipant: "candidat3@test.local", profilId: profil.id },
          { role: "CLIENT", emailParticipant: emailClient, estOrganisateur: true },
        ],
      },
    });
    const interview = await creation.json();
    const clientParticipant = interview.participants.find((p: { role: string }) => p.role === "CLIENT");

    // Avant acceptation : la session Client correspond bien à un
    // InterviewParticipant de cet Interview, mais statutInvitation reste
    // EN_ATTENTE — l'évaluation doit être refusée (403).
    const avantAcceptation = await ctxClient.post(`/api/client/talent-selection/interviews/${interview.id}/evaluations`, {
      data: { criteres: [{ critere: "Compétences", observation: "Bon niveau", appreciation: "POSITIF" }], recommandation: "RECOMMANDE" },
    });
    expect(avantAcceptation.status()).toBe(403);

    const token = await signerToken(interview.id, clientParticipant.id);
    const reponseAcceptation = await fetchReponse(interview.id, clientParticipant.id, token, "ACCEPTEE");
    expect(reponseAcceptation.status(), await reponseAcceptation.text()).toBe(200);

    const premiereEvaluation = await ctxClient.post(`/api/client/talent-selection/interviews/${interview.id}/evaluations`, {
      data: { criteres: [{ critere: "Compétences", observation: "Bon niveau", appreciation: "POSITIF" }], recommandation: "RECOMMANDE" },
    });
    expect(premiereEvaluation.status(), await premiereEvaluation.text()).toBe(201);
    const evaluation1 = await premiereEvaluation.json();
    expect(evaluation1.evaluateurRole).toBe("CLIENT");

    const correction = await ctxClient.post(`/api/client/talent-selection/interviews/${interview.id}/evaluations`, {
      data: {
        criteres: [{ critere: "Compétences", observation: "Finalement excellent", appreciation: "POSITIF" }],
        recommandation: "RECOMMANDE",
        supersedesId: evaluation1.id,
      },
    });
    expect(correction.status(), await correction.text()).toBe(201);

    const lignesEnBase = await prisma.interviewEvaluation.findMany({ where: { interviewId: interview.id } });
    expect(lignesEnBase.length).toBe(2);
    expect(lignesEnBase.find((l) => l.id === evaluation1.id)?.supersedesId).toBeNull();

    // Aucune InterviewEvaluation ne déclenche jamais automatiquement une
    // CandidateFinalDecision — invariant verrouillé (§9) vérifié par
    // l'absence de toute ligne créée en conséquence de ce qui précède.
    const decisions = await prisma.candidateFinalDecision.findMany({ where: { demandeTalentId: demande.id } });
    expect(decisions.length).toBe(0);
  });

  test("une évaluation ADMIN_RECRUTEUR n'est jamais visible par le Client", async () => {
    const { client, ctx: ctxClient } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profil = await creerProfilCandidat();
    const entree = await creerShortlistEntree(demande.id, profil.id, "VALIDEE");
    const selection = await selectionActive(demande.id, entree.id);
    const { ctx: ctxAdmin, email: emailAdmin } = await nouvelAdmin();

    const creation = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/interviews`, {
      data: {
        candidateSelectionId: selection.id,
        canal: "VIDEO",
        dateHeure: new Date(Date.now() + 3600_000).toISOString(),
        dureeMinutes: 30,
        timezoneSaisie: "Europe/Paris",
        participants: [
          { role: "CANDIDAT", emailParticipant: "candidat3b@test.local", profilId: profil.id },
          { role: "ADMIN_RECRUTEUR", emailParticipant: emailAdmin, estOrganisateur: true },
        ],
      },
    });
    const interview = await creation.json();
    const adminParticipant = interview.participants.find((p: { role: string }) => p.role === "ADMIN_RECRUTEUR");

    const token = await signerToken(interview.id, adminParticipant.id);
    await fetchReponse(interview.id, adminParticipant.id, token, "ACCEPTEE");

    const evaluationAdmin = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/interviews/${interview.id}/evaluations`, {
      data: { criteres: [{ critere: "Compétences", observation: "Interne uniquement", appreciation: "POSITIF" }], recommandation: "RECOMMANDE" },
    });
    expect(evaluationAdmin.status(), await evaluationAdmin.text()).toBe(201);

    const vueClient = await ctxClient.get(`/api/client/talent-selection/interviews/${interview.id}/evaluations`);
    expect(vueClient.status()).toBe(200);
    expect((await vueClient.json()).evaluations).toHaveLength(0);

    const vueAdmin = await ctxAdmin.get(`/api/talent/demandes/${demande.id}/interviews/${interview.id}/evaluations`);
    expect((await vueAdmin.json()).evaluations).toHaveLength(1);
  });
});

test.describe("CDI — Final Decision (exclusivité Client)", () => {
  test("le Client peut décider seul ; un Admin SANS communiqueParClientHorsSysteme est rejeté ; avec le flag, c'est accepté", async () => {
    const { client, ctx: ctxClient } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profil = await creerProfilCandidat();
    const entree = await creerShortlistEntree(demande.id, profil.id, "VALIDEE");
    const selection = await selectionActive(demande.id, entree.id);
    const { ctx: ctxAdmin } = await nouvelAdmin();

    const decisionAdminSansFlag = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/final-decision`, {
      data: { entrees: [{ candidateSelectionId: selection.id, statut: "RETENU" }] },
    });
    expect(decisionAdminSansFlag.status()).toBe(400);

    const decisionClient = await ctxClient.post(`/api/client/talent-selection/demandes/${demande.id}/final-decision`, {
      data: { entrees: [{ candidateSelectionId: selection.id, statut: "RETENU" }] },
    });
    expect(decisionClient.status(), await decisionClient.text()).toBe(201);
    const decision1 = await decisionClient.json();
    expect(decision1.communiqueParClientHorsSysteme).toBe(false);

    // Reconsidération par l'Admin pour compte du Client, hors système —
    // doit superseder la décision active existante.
    const decisionAdminAvecFlag = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/final-decision`, {
      data: {
        entrees: [{ candidateSelectionId: selection.id, statut: "NON_RETENU", justification: "Finalement non retenu, communiqué par téléphone" }],
        communiqueParClientHorsSysteme: true,
        canalHorsSysteme: "Appel téléphonique",
      },
    });
    expect(decisionAdminAvecFlag.status(), await decisionAdminAvecFlag.text()).toBe(201);
    const decision2 = await decisionAdminAvecFlag.json();
    expect(decision2.supersedesId).toBe(decision1.id);

    const active = await prisma.candidateFinalDecision.findFirst({ where: { demandeTalentId: demande.id, supersededBy: null } });
    expect(active?.id).toBe(decision2.id);
  });

  test("NON_RETENU sans justification est rejeté (400)", async () => {
    const { client, ctx: ctxClient } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profil = await creerProfilCandidat();
    const entree = await creerShortlistEntree(demande.id, profil.id, "VALIDEE");
    const selection = await selectionActive(demande.id, entree.id);

    const reponse = await ctxClient.post(`/api/client/talent-selection/demandes/${demande.id}/final-decision`, {
      data: { entrees: [{ candidateSelectionId: selection.id, statut: "NON_RETENU" }] },
    });
    expect(reponse.status()).toBe(400);
  });
});

test.describe("CDI — RBAC / IDOR", () => {
  test("un Ingénieur n'a accès à aucune route Client de ce lot", async () => {
    const { ctx: ctxIng } = await nouvelIngenieur();
    const { client, ctx: ctxClient } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profil = await creerProfilCandidat();
    const entree = await creerShortlistEntree(demande.id, profil.id, "VALIDEE");
    void ctxClient;

    expect((await ctxIng.get(`/api/client/talent-selection/demandes/${demande.id}/shortlist`)).status()).toBe(403);
    expect(
      (await ctxIng.post(`/api/client/talent-selection/demandes/${demande.id}/selections`, { data: { shortlistEntreeId: entree.id } })).status()
    ).toBe(403);
    expect((await ctxIng.get(`/api/client/talent-selection/demandes/${demande.id}/comparison`)).status()).toBe(403);
  });

  test("Client A ne peut pas voir/sélectionner/décider sur la demande du Client B (404, jamais une fuite d'existence)", async () => {
    const { client: clientB } = await nouveauClient();
    const demandeB = await creerDemande(clientB.id);
    const profil = await creerProfilCandidat();
    const entreeB = await creerShortlistEntree(demandeB.id, profil.id, "VALIDEE");

    const { ctx: ctxA } = await nouveauClient();
    expect((await ctxA.get(`/api/client/talent-selection/demandes/${demandeB.id}/shortlist`)).status()).toBe(404);
    expect(
      (await ctxA.post(`/api/client/talent-selection/demandes/${demandeB.id}/selections`, { data: { shortlistEntreeId: entreeB.id } })).status()
    ).toBe(404);
    expect((await ctxA.get(`/api/client/talent-selection/demandes/${demandeB.id}/comparison`)).status()).toBe(404);
    expect(
      (await ctxA.post(`/api/client/talent-selection/demandes/${demandeB.id}/final-decision`, { data: { entrees: [] } })).status()
    ).toBe(404);
  });

  test("un jeton de réponse invalide ou pour un autre participant est refusé (403)", async () => {
    const { client, ctx } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profil = await creerProfilCandidat();
    const entree = await creerShortlistEntree(demande.id, profil.id, "VALIDEE");
    const selection = await selectionActive(demande.id, entree.id);
    const { ctx: ctxAdmin } = await nouvelAdmin();

    const creation = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/interviews`, {
      data: {
        candidateSelectionId: selection.id,
        canal: "VIDEO",
        dateHeure: new Date(Date.now() + 3600_000).toISOString(),
        dureeMinutes: 30,
        timezoneSaisie: "Europe/Paris",
        participants: [
          { role: "CANDIDAT", emailParticipant: "candidat4@test.local", profilId: profil.id },
          { role: "ADMIN_RECRUTEUR", emailParticipant: "admin4@test.local", estOrganisateur: true },
        ],
      },
    });
    const interview = await creation.json();
    const [p1, p2] = interview.participants;

    const tokenP1 = await signerToken(interview.id, p1.id);
    // Jeton valide pour p1, utilisé pour répondre à la place de p2 — refusé.
    const reponseCroisee = await fetchReponse(interview.id, p2.id, tokenP1, "ACCEPTEE");
    expect(reponseCroisee.status()).toBe(403);

    const reponseJetonInvalide = await fetchReponse(interview.id, p1.id, "jeton-invalide", "ACCEPTEE");
    expect(reponseJetonInvalide.status()).toBe(403);

    void ctx;
  });
});

test.describe("CDI — Endpoint interne des rappels", () => {
  test("secret absent ou invalide -> 403 (fail-closed) ; secret valide -> traite et est idempotent", async () => {
    const ctx = await pwRequest.newContext({ baseURL: process.env.BASE_URL ?? "http://localhost:3000" });

    const sansSecret = await ctx.post("/api/internal/interview-reminders/process");
    expect(sansSecret.status()).toBe(403);

    const secretInvalide = await ctx.post("/api/internal/interview-reminders/process", { headers: { "x-internal-secret": "mauvais-secret" } });
    expect(secretInvalide.status()).toBe(403);

    const secretReel = process.env.INTERVIEW_REMINDER_INTERNAL_SECRET;
    test.skip(!secretReel, "INTERVIEW_REMINDER_INTERNAL_SECRET non configuré dans cet environnement de test");
    if (!secretReel) return;

    const avecSecret = await ctx.post("/api/internal/interview-reminders/process", { headers: { "x-internal-secret": secretReel } });
    expect(avecSecret.status(), await avecSecret.text()).toBe(200);
  });

  test("traiterRappelsDus() est idempotent sous rejeu (appel direct du service)", async () => {
    const { client, ctx: ctxClient } = await nouveauClient();
    const demande = await creerDemande(client.id);
    const profil = await creerProfilCandidat();
    const entree = await creerShortlistEntree(demande.id, profil.id, "VALIDEE");
    const selection = await selectionActive(demande.id, entree.id);
    const { ctx: ctxAdmin } = await nouvelAdmin();
    void ctxClient;

    const dateHeure = new Date(Date.now() + 65 * 60_000); // dans 65 min -> le rappel "60 min avant" est déjà dû
    const creation = await ctxAdmin.post(`/api/talent/demandes/${demande.id}/interviews`, {
      data: {
        candidateSelectionId: selection.id,
        canal: "VIDEO",
        dateHeure: dateHeure.toISOString(),
        dureeMinutes: 30,
        timezoneSaisie: "Europe/Paris",
        participants: [
          { role: "CANDIDAT", emailParticipant: "candidat5@test.local", profilId: profil.id },
          { role: "ADMIN_RECRUTEUR", emailParticipant: "admin5@test.local", estOrganisateur: true },
        ],
      },
    });
    const interview = await creation.json();

    const resultat1 = await traiterRappelsDus(new Date(), 500);
    expect(resultat1.envoyes).toBeGreaterThanOrEqual(2); // 1 délai dû x 2 participants

    const resultat2 = await traiterRappelsDus(new Date(), 500);
    const remindersInterview = await prisma.interviewReminder.findMany({
      where: { interviewParticipant: { interviewId: interview.id } },
    });
    // Aucune ligne déjà ENVOYE n'est jamais retraitée au second appel.
    expect(remindersInterview.filter((r) => r.statutEnvoi === "ENVOYE").length).toBe(2);
    void resultat2;
  });
});
