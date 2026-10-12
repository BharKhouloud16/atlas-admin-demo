"use client";

import { useEffect, useState, FormEvent, Fragment } from "react";
import Link from "next/link";
import { bleuFonce, bleu, grisTexte, bordure } from "@/lib/theme";
import MissionClosureReview from "./MissionClosureReview";
import MissionOutcomePanel from "./MissionOutcomePanel";

type Mission = {
  id: string;
  // MISSION CLOSURE INTELLIGENCE : profilId est déjà renvoyé tel quel par
  // GET /api/missions pour l'Admin (spread `...m` du Mission Prisma brut,
  // voir app/api/missions/route.ts) — jamais un nouvel appel, jamais un
  // profilId accepté depuis un formulaire : c'est la même valeur que le
  // serveur utilise déjà pour construire ce même objet.
  profilId: string;
  repere: string | null;
  nbJours: number;
  statut: string;
  tjmVente?: number;
  ca?: number | null;
  margeEuros?: number | null;
  margePct?: number | null;
  client: { nom: string };
  profil?: { nom: string; prenom?: string | null };
  // COMPANY ATLAS — LOT 6 : Mission Context Bridge (16/09/2026).
  dateDebut?: string | null;
  modeTravail?: string | null;
  sourceDemande?: { id: string; titre: string | null } | null;
};

type ClientOption = { id: string; nom: string };
type ProfilOption = { id: string; nom: string; prenom?: string | null };

// DB-03 — MISSION DECISION PINNING (audit Product V1, rupture DB-03). Le
// backend (lib/mission/need-pinning.ts::validerPinsMission, A18) sait déjà
// recevoir/valider needVersionId + solutionDecisionId, mais jusqu'ici aucun
// écran ne les collectait. Types ci-dessous : reflet strict de ce que
// GET /api/talent/besoins et GET /api/talent/besoins/[id]/solutions
// renvoient déjà — aucun nouveau champ, aucune nouvelle route.
type BesoinOption = { id: string; clientId: string; titre: string | null; texteOriginal: string };
type SolutionDecisionOption = { id: string; titre: string; justification: string; decideLe: string | null };

// LOT 16.3 — MISSION LIST SCALABILITY. Même valeur par défaut que
// PAGE_SIZE_DEFAUT côté serveur (app/api/missions/route.ts) — envoyée
// explicitement pour ne jamais dépendre implicitement du défaut serveur.
const TAILLE_PAGE = 20;

const TEMPLATES = [
  { key: "contrat_prestation", label: "Contrat de prestation (client)" },
  { key: "nda", label: "Accord de confidentialité" },
  { key: "cdi", label: "CDI ingénieur" },
  { key: "freelance", label: "Contrat freelance" },
  { key: "portage", label: "Convention de portage" },
];

function nomIngenieur(p?: { nom: string; prenom?: string | null }): string {
  if (!p) return "—";
  return p.prenom ? `${p.prenom} ${p.nom}` : p.nom;
}

// Deux usages bien distincts sur cette page, volontairement séparés
// visuellement : (1) le suivi opérationnel et financier des missions
// (tableau ci-dessous — qui, chez qui, depuis quand, TJM, CA, marge), et
// (2) la génération de contrats (dernière colonne, une fois l'entretien de
// l'ingénieur validé) — le système de génération lui-même (docx) existe déjà
// et n'a pas été reconstruit, seul cet écran a été clarifié.
export default function MissionsPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);

  // Formulaire "Nouvelle mission" — l'API POST /api/missions existait déjà
  // (voir app/api/missions/route.ts) mais aucun écran ne l'appelait : ce
  // bloc corrige cette étape manquante du parcours Matching → Mission,
  // sans toucher au reste de la page ni ajouter de logique côté serveur.
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [profils, setProfils] = useState<ProfilOption[]>([]);
  const [afficherFormulaire, setAfficherFormulaire] = useState(false);
  const [clientId, setClientId] = useState("");
  const [profilId, setProfilId] = useState("");
  const [repere, setRepere] = useState("");
  const [nbJours, setNbJours] = useState("");
  const [tjmVente, setTjmVente] = useState("");
  const [creation, setCreation] = useState(false);
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);

  // DB-03 — Need (besoin) et SolutionDecision (optionnels) : needVersionId/
  // solutionDecisionId ne sont JAMAIS envoyés si l'Admin ne les sélectionne
  // pas explicitement — comportement métier existant (Mission indépendante)
  // préservé à l'identique (voir "Aucun (mission indépendante)" ci-dessous).
  const [besoins, setBesoins] = useState<BesoinOption[]>([]);
  const [needId, setNeedId] = useState("");
  const [decisions, setDecisions] = useState<SolutionDecisionOption[]>([]);
  const [decisionId, setDecisionId] = useState("");
  const [chargementDecisions, setChargementDecisions] = useState(false);

  // Phase 2B-0 — Mission Lifecycle : transition minimale Terminer/Annuler,
  // réservée Admin (voir app/api/missions/[id]/transition/route.ts). Ne
  // simule jamais localement la transition : le tableau est toujours
  // rechargé depuis le serveur après succès.
  const [transition, setTransition] = useState<string | null>(null);
  const [erreurTransition, setErreurTransition] = useState<string | null>(null);

  // MISSION CLOSURE INTELLIGENCE (post-2B-1) : le clic "Terminer" ouvre
  // désormais ce panneau au lieu d'appeler transitionnerMission()
  // directement — transitionnerMission() reste utilisée telle quelle pour
  // "Annuler", inchangée. La route app/api/missions/[id]/transition/route.ts
  // elle-même n'est ni modifiée ni appelée différemment : c'est le panneau
  // (MissionClosureReview.tsx) qui l'appelle pour "Terminer la mission",
  // avec exactement le même contrat. Un seul panneau ouvert à la fois (un
  // missionId, jamais un Set) : SOFT GATE, jamais bloquant, purement une
  // couche UI autour du lifecycle existant.
  const [revueOuverte, setRevueOuverte] = useState<string | null>(null);
  // A6.1 — Outcome Foundation : état séparé de revueOuverte (A6 §A6.3 —
  // ne jamais fusionner Evidence/Quality des compétences Ingénieur et
  // Outcome du Need dans un même panneau/état).
  const [outcomeOuvert, setOutcomeOuvert] = useState<string | null>(null);

  // LOT 16.3 — MISSION LIST SCALABILITY : `page`/`total`/`totalPages`
  // proviennent toujours du serveur (jamais recalculés côté client) — voir
  // app/api/missions/route.ts. `page` par défaut à 1, mis à jour uniquement
  // depuis la réponse serveur après chaque rechargement.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  function rechargerMissions(pageDemandee: number = page): Promise<unknown> {
    return fetch(`/api/missions?page=${pageDemandee}&pageSize=${TAILLE_PAGE}`)
      .then((r) => r.json())
      .then((data) => {
        setMissions(data.items);
        setPage(data.page);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        // Page devenue invalide (ex. le nombre total de missions a diminué
        // depuis la dernière page connue) : recharge automatiquement la
        // dernière page réellement disponible plutôt que d'afficher un
        // tableau vide sur une page qui n'existe plus.
        if (data.items.length === 0 && data.page > 1 && data.page > data.totalPages) {
          return rechargerMissions(data.totalPages);
        }
        return data;
      });
  }

  useEffect(() => {
    rechargerMissions(1);

    // Détection du rôle : déduire "ADMIN" de la présence de tjmVente dans
    // /api/missions échoue à tort quand la liste est vide (aucune mission
    // encore créée) — un Admin sans mission était alors traité comme un
    // Ingénieur et perdait les colonnes financières et ce formulaire. Un
    // appel direct à une route réservée à l'Admin (/api/clients, 200 vs 403)
    // donne la réponse sans cette ambiguïté, sans rien changer côté serveur.
    fetch("/api/clients").then((r) => {
      if (r.ok) {
        setRole("ADMIN");
        r.json().then(setClients);
        fetch("/api/profils").then((r2) => (r2.ok ? r2.json() : { profils: [] })).then((d) => setProfils(d.profils ?? [])).catch(() => {});
        // DB-03 : vue transverse déjà existante (GET /api/talent/besoins,
        // réservée ADMIN) — réutilisée telle quelle, jamais une nouvelle
        // route ; filtrée par clientId côté client au rendu ci-dessous.
        fetch("/api/talent/besoins").then((r3) => (r3.ok ? r3.json() : { besoins: [] })).then((d) => setBesoins(d.besoins ?? [])).catch(() => {});
      } else {
        setRole("INGENIEUR");
      }
    }).catch(() => {});
  }, []);

  // DB-03 : un besoin sélectionné déclenche la récupération de ses
  // SolutionDecision réelles (niveau=DECISION uniquement, déjà filtré par
  // GET /api/talent/besoins/[id]/solutions — jamais une RECOMMANDATION/
  // OPTION/HYPOTHESE affichée ici). Aucune décision disponible -> liste
  // vide, jamais une valeur inventée.
  useEffect(() => {
    if (!needId) {
      setDecisions([]);
      setDecisionId("");
      return;
    }
    setChargementDecisions(true);
    setDecisionId("");
    fetch(`/api/talent/besoins/${needId}/solutions`)
      .then((r) => (r.ok ? r.json() : { decisions: [] }))
      .then((d) => setDecisions(d.decisions ?? []))
      .catch(() => setDecisions([]))
      .finally(() => setChargementDecisions(false));
  }, [needId]);

  async function creerMission(e: FormEvent) {
    e.preventDefault();
    setErreurCreation(null);
    if (!clientId || !profilId || !nbJours || !tjmVente) {
      setErreurCreation("Client, ingénieur, nombre de jours et TJM vente sont requis.");
      return;
    }
    setCreation(true);
    const res = await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        profilId,
        repere: repere || undefined,
        nbJours: Number(nbJours),
        tjmVente: Number(tjmVente),
        // DB-03 : jamais envoyés si l'Admin n'a rien sélectionné — le
        // backend (validerPinsMission) reste seul juge de leur validité ;
        // ce formulaire ne fait que transmettre un choix explicite, jamais
        // une valeur devinée.
        needVersionId: needId || undefined,
        solutionDecisionId: decisionId || undefined,
      }),
    });
    setCreation(false);
    if (!res.ok) {
      const err = await res.json();
      setErreurCreation(err.error ?? "Erreur lors de la création de la mission");
      return;
    }
    setClientId("");
    setProfilId("");
    setRepere("");
    setNbJours("");
    setTjmVente("");
    setNeedId("");
    setDecisionId("");
    setAfficherFormulaire(false);
    // La nouvelle mission apparaît en tête de tri (createdAt desc) : revenir
    // à la page 1 pour la rendre immédiatement visible, plutôt que rester
    // sur une page où elle ne figure jamais.
    await rechargerMissions(1);
  }

  async function transitionnerMission(missionId: string, action: "terminer" | "annuler") {
    const libelle = action === "terminer" ? "terminer" : "annuler";
    if (!confirm(`Confirmer : ${libelle} cette mission ? Cette action est définitive.`)) return;

    // LOT 16.3 FIX (A35.14) — "annuler" exige TOUJOURS un motif non vide
    // (lib/mission/lifecycle.ts, contrat A22 §12, inchangé) : ce bouton ne
    // le transmettait jamais, causant un rejet 400 systématique (cause
    // confirmée A35.13 §7). Même convention que demanderEtTransitionner()
    // dans app/admin/missions/[id]/work-items/[workItemId]/page.tsx :
    // prompt() obligatoire, abandon local si vide — jamais un contournement
    // de la validation serveur, qui reste seule juge en dernier ressort.
    let motif: string | undefined;
    if (action === "annuler") {
      const saisie = prompt("Motif de l'annulation :");
      if (!saisie) return;
      motif = saisie;
    }

    setErreurTransition(null);
    setTransition(missionId + action);
    const res = await fetch(`/api/missions/${missionId}/transition`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, motif }),
    });
    setTransition(null);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurTransition(err.error ?? "Erreur lors de la transition de la mission.");
      return;
    }
    await rechargerMissions();
  }

  async function generer(missionId: string, templateKey: string) {
    setGenerating(missionId + templateKey);
    const res = await fetch("/api/generate-contract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missionId, templateKey }),
    });
    setGenerating(null);

    if (!res.ok) {
      const err = await res.json();
      alert(err.error ?? "Erreur de génération");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${templateKey}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isAdmin = role === "ADMIN";

  return (
    <div>
      <h1 style={{ marginBottom: 4, color: bleuFonce }}>Missions</h1>
      <p style={{ fontSize: 13, color: grisTexte, marginBottom: 20, maxWidth: 760 }}>
        Suivi opérationnel et financier de chaque mission (qui, chez quel client, TJM, CA et marge). La
        génération des contrats et avenants se fait mission par mission via la colonne « Générer », une fois
        l'entretien de l'ingénieur validé.
      </p>

      {isAdmin && (
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => setAfficherFormulaire((v) => !v)}
            style={{ padding: "6px 14px", fontWeight: 600, border: `1px solid ${bordure}`, background: "#fff", color: bleuFonce, cursor: "pointer" }}
          >
            {afficherFormulaire ? "Annuler" : "+ Nouvelle mission"}
          </button>

          {afficherFormulaire && (
            <form
              onSubmit={creerMission}
              style={{
                marginTop: 12,
                padding: 16,
                border: `1px solid ${bordure}`,
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "flex-end",
                maxWidth: 900,
              }}
            >
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                Client
                <select
                  value={clientId}
                  onChange={(e) => {
                    // DB-03 : un besoin/décision sélectionné appartient au
                    // Client précédent — changer de Client sans les
                    // réinitialiser risquerait d'envoyer un needVersionId
                    // d'un autre tenant (le backend le refuserait de toute
                    // façon, mais ce formulaire ne doit jamais présenter un
                    // choix devenu incohérent).
                    setClientId(e.target.value);
                    setNeedId("");
                    setDecisionId("");
                  }}
                  style={{ padding: 6, minWidth: 180 }}
                >
                  <option value="">Choisir...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                Besoin d'origine (optionnel)
                <select value={needId} onChange={(e) => setNeedId(e.target.value)} disabled={!clientId} style={{ padding: 6, minWidth: 220 }}>
                  <option value="">Aucun (mission indépendante)</option>
                  {besoins.filter((b) => b.clientId === clientId).map((b) => (
                    <option key={b.id} value={b.id}>{b.titre ?? b.texteOriginal.slice(0, 60)}</option>
                  ))}
                </select>
              </label>
              {needId && (
                <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                  Décision de solution
                  <select
                    value={decisionId}
                    onChange={(e) => setDecisionId(e.target.value)}
                    disabled={chargementDecisions || decisions.length === 0}
                    style={{ padding: 6, minWidth: 260 }}
                  >
                    <option value="">
                      {chargementDecisions
                        ? "Chargement..."
                        : decisions.length === 0
                        ? "Aucune décision finalisée pour ce besoin"
                        : "Aucune (mission non rattachée à une décision)"}
                    </option>
                    {decisions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.titre}
                        {d.decideLe ? ` — décidée le ${new Date(d.decideLe).toLocaleDateString("fr-FR")}` : ""}
                      </option>
                    ))}
                  </select>
                  {!chargementDecisions && decisions.length === 0 && (
                    <span style={{ fontSize: 11, color: "#888" }}>
                      Ce besoin n&apos;a pas encore de décision de solution finalisée — la mission sera créée sans rattachement à une décision.
                    </span>
                  )}
                </label>
              )}
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                Ingénieur
                <select value={profilId} onChange={(e) => setProfilId(e.target.value)} style={{ padding: 6, minWidth: 180 }}>
                  <option value="">Choisir...</option>
                  {profils.map((p) => (
                    <option key={p.id} value={p.id}>{nomIngenieur(p)}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                Repère (optionnel)
                <input value={repere} onChange={(e) => setRepere(e.target.value)} style={{ padding: 6, width: 160 }} />
              </label>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                Nombre de jours
                <input type="number" min={1} value={nbJours} onChange={(e) => setNbJours(e.target.value)} style={{ padding: 6, width: 100 }} />
              </label>
              <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                TJM vente (€)
                <input type="number" min={0} value={tjmVente} onChange={(e) => setTjmVente(e.target.value)} style={{ padding: 6, width: 100 }} />
              </label>
              <button type="submit" disabled={creation} style={{ padding: "8px 16px", fontWeight: 600 }}>
                {creation ? "Création..." : "Créer la mission"}
              </button>
              {erreurCreation && <p style={{ fontSize: 12, color: "#b91c1c", width: "100%", margin: 0 }}>{erreurCreation}</p>}
            </form>
          )}
        </div>
      )}

      {erreurTransition && <p style={{ fontSize: 12, color: "#b91c1c", marginBottom: 12 }}>{erreurTransition}</p>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
              <th style={{ padding: "6px 8px" }}>Client</th>
              <th style={{ padding: "6px 8px" }}>Ingénieur</th>
              <th style={{ padding: "6px 8px" }}>Repère</th>
              <th style={{ padding: "6px 8px" }}>Jours</th>
              <th style={{ padding: "6px 8px" }}>Début</th>
              <th style={{ padding: "6px 8px" }}>Mode</th>
              <th style={{ padding: "6px 8px" }}>Statut</th>
              {isAdmin && <th style={{ padding: "6px 8px" }}>TJM vente</th>}
              {isAdmin && <th style={{ padding: "6px 8px" }}>CA prévisionnel</th>}
              {isAdmin && <th style={{ padding: "6px 8px" }}>Marge €</th>}
              {isAdmin && <th style={{ padding: "6px 8px" }}>Marge %</th>}
              {isAdmin && <th style={{ padding: "6px 8px" }}>Générer un contrat</th>}
            </tr>
          </thead>
          <tbody>
            {missions.map((m) => (
              <Fragment key={m.id}>
              <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 8px" }}>{m.client.nom}</td>
                <td style={{ padding: "6px 8px" }}>{nomIngenieur(m.profil)}</td>
                <td style={{ padding: "6px 8px" }}>{m.repere ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>{m.nbJours}</td>
                <td style={{ padding: "6px 8px" }}>{m.dateDebut ? new Date(m.dateDebut).toLocaleDateString("fr-FR") : "—"}</td>
                <td style={{ padding: "6px 8px" }}>{m.modeTravail ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>
                  {m.statut}
                  {m.sourceDemande && (
                    <>
                      {" "}
                      ·{" "}
                      <Link href={`/admin/talent/${m.sourceDemande.id}`} style={{ color: bleu, fontSize: 11 }}>
                        depuis besoin
                      </Link>
                    </>
                  )}
                  {/* DB-01 — Delivery UI : WorkItem/Deliverable/Evidence restent
                      strictement Admin-only (A23/A24, aucune route n'accepte
                      INGENIEUR) — ce lien n'est donc jamais affiché à l'Ingénieur,
                      même si cette page lui reste par ailleurs accessible. */}
                  {isAdmin && (
                    <div style={{ marginTop: 4, display: "flex", gap: 10 }}>
                      <Link href={`/admin/missions/${m.id}/work-items`} style={{ fontSize: 11, color: bleu }}>
                        WorkItems →
                      </Link>
                      {/* DB-02 — Financial Result UI : surface strictement
                          Admin, jamais Client/Ingénieur (A29 §28/§29). */}
                      <Link href={`/admin/missions/${m.id}/financial-results`} style={{ fontSize: 11, color: bleu }}>
                        Résultat financier →
                      </Link>
                      {/* DB-09 — Capability UI : MissionCapabilityLink (A21)
                          reste strictement Admin-only (contrat A21 §14, même
                          restriction que WorkItems/Financial ci-dessus) —
                          jamais exposé à l'Ingénieur/Client par ce lot. */}
                      <Link href={`/admin/missions/${m.id}/capabilities`} style={{ fontSize: 11, color: bleu }}>
                        Capabilities →
                      </Link>
                    </div>
                  )}
                  {/* DB-04 — Learning UI : contrairement à WorkItem/Financial,
                      la lecture Learning est accordée à l'Ingénieur autorisé sur
                      cette Mission (contrat A30 §18, même fonction
                      estIngenieurAutoriseSurMission que A26/A27/A29) — ce lien
                      n'est donc jamais gated par isAdmin, à la différence des
                      deux ci-dessus. */}
                  <div style={{ marginTop: 4 }}>
                    <Link href={`/admin/missions/${m.id}/learning`} style={{ fontSize: 11, color: bleu }}>
                      Learning →
                    </Link>
                  </div>
                  {isAdmin && m.statut === "EN_COURS" && (
                    <div style={{ marginTop: 4, display: "flex", gap: 8 }}>
                      {/* MISSION CLOSURE INTELLIGENCE : "Terminer" ouvre désormais la
                          Revue de clôture au lieu d'appeler la transition directement
                          via confirm() — la transition elle-même n'a lieu que depuis le
                          bouton "Terminer la mission" à l'intérieur du panneau (voir
                          MissionClosureReview.tsx), qui appelle la même route PATCH
                          .../transition, inchangée. */}
                      <button
                        onClick={() => setRevueOuverte(m.id)}
                        style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}
                      >
                        Terminer
                      </button>
                      <button
                        onClick={() => transitionnerMission(m.id, "annuler")}
                        disabled={transition === m.id + "annuler"}
                        style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}
                      >
                        Annuler
                      </button>
                    </div>
                  )}
                  {isAdmin && (m.statut === "TERMINEE" || m.statut === "ANNULEE") && (
                    <div style={{ marginTop: 4 }}>
                      <button
                        onClick={() => setRevueOuverte((v) => (v === m.id ? null : m.id))}
                        style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}
                      >
                        {revueOuverte === m.id ? "Fermer la revue" : "Revue de clôture"}
                      </button>
                    </div>
                  )}
                  {isAdmin && m.statut === "TERMINEE" && (
                    <div style={{ marginTop: 4 }}>
                      <button
                        onClick={() => setOutcomeOuvert((v) => (v === m.id ? null : m.id))}
                        style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}
                      >
                        {outcomeOuvert === m.id ? "Fermer l'Outcome" : "Résultat attendu (Outcome)"}
                      </button>
                    </div>
                  )}
                </td>
                {isAdmin && <td style={{ padding: "6px 8px" }}>{m.tjmVente != null ? Math.round(m.tjmVente) + " €" : "—"}</td>}
                {isAdmin && <td style={{ padding: "6px 8px" }}>{m.ca != null ? Math.round(m.ca).toLocaleString("fr-FR") + " €" : "—"}</td>}
                {isAdmin && (
                  <td style={{ padding: "6px 8px", color: m.margeEuros != null && m.margeEuros < 0 ? "#b91c1c" : undefined }}>
                    {m.margeEuros != null ? Math.round(m.margeEuros).toLocaleString("fr-FR") + " €" : "—"}
                  </td>
                )}
                {isAdmin && <td style={{ padding: "6px 8px" }}>{m.margePct != null ? Math.round(m.margePct * 100) + " %" : "—"}</td>}
                {isAdmin && (
                  <td style={{ padding: "6px 8px" }}>
                    <select
                      onChange={(e) => {
                        if (e.target.value) generer(m.id, e.target.value);
                        e.target.value = "";
                      }}
                      disabled={generating?.startsWith(m.id)}
                    >
                      <option value="">Choisir un contrat...</option>
                      {TEMPLATES.map((t) => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                      ))}
                    </select>
                  </td>
                )}
              </tr>
              {revueOuverte === m.id && (
                <tr>
                  <td colSpan={isAdmin ? 12 : 7} style={{ padding: 0 }}>
                    <MissionClosureReview
                      mission={m}
                      onFermer={() => setRevueOuverte(null)}
                      onMissionTerminee={() => {
                        // Le panneau reste ouvert (mandat section 9.D) : seule la
                        // liste est rechargée, ce qui met m.statut à jour et fait
                        // disparaître "Terminer la mission" au rendu suivant.
                        rechargerMissions();
                      }}
                    />
                  </td>
                </tr>
              )}
              {outcomeOuvert === m.id && (
                <tr>
                  <td colSpan={isAdmin ? 12 : 7} style={{ padding: 0 }}>
                    <MissionOutcomePanel missionId={m.id} onFermer={() => setOutcomeOuvert(null)} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {missions.length === 0 && (
          <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Aucune mission pour l'instant.</p>
        )}
      </div>

      {total > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 13 }}>
          <button
            onClick={() => rechargerMissions(page - 1)}
            disabled={page <= 1}
            style={{ padding: "4px 10px", border: `1px solid ${bordure}`, background: "#fff", cursor: page <= 1 ? "default" : "pointer", opacity: page <= 1 ? 0.5 : 1 }}
          >
            Précédent
          </button>
          <span style={{ color: grisTexte }}>
            Page {page} / {totalPages} — {total} mission{total > 1 ? "s" : ""} au total
          </span>
          <button
            onClick={() => rechargerMissions(page + 1)}
            disabled={page >= totalPages}
            style={{ padding: "4px 10px", border: `1px solid ${bordure}`, background: "#fff", cursor: page >= totalPages ? "default" : "pointer", opacity: page >= totalPages ? 0.5 : 1 }}
          >
            Suivant
          </button>
        </div>
      )}
    </div>
  );
}
