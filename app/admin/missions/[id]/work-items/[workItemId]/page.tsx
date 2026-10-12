"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { bleuFonce, bleu, grisTexte, bordure, rouge } from "@/lib/theme";

// COMPANY ATLAS — DB-01 : Delivery UI (08/10/2026).
//
// Détail WorkItem — réservé ADMIN (contrat A23/A24, aucune route
// WorkItem/WorkItemAssignment n'accepte INGENIEUR). Chaque action de cet
// écran appelle EXACTEMENT une route déjà existante et déjà testée
// (A23/A24/A25/A26) — aucune transition, aucune validation, aucun calcul
// de statut n'est jamais fait côté client : le serveur reste seul juge
// (boutons simplement dérivés de TRANSITIONS_AUTORISEES déjà encodée côté
// serveur ; un refus serveur affiche son message, jamais masqué).
//
// La liste des Deliverable liés utilise la nouvelle route additive
// GET /api/missions/[id]/work-items/[workItemId]/deliverables (DB-01) —
// seule lecture manquante côté backend (contrat DB-01 §22 : "API absente
// mais service existant -> route minimale"), jamais une logique de lien
// dupliquée (création/suppression de lien restent exclusivement sur les
// routes A25 existantes, Admin-only, inchangées).

const RAISONS_BLOCAGE = ["CLIENT_DEPENDENCY", "TALENT_DEPENDENCY", "TECHNICAL", "ACCESS", "EXTERNAL", "UNKNOWN"] as const;
const NATURES_CONTENU = ["DOCUMENT", "STRUCTURE", "OPERATION", "DECLARATIF"] as const;
const METHODES_EVIDENCE = ["DECLARATION_TALENT", "VALIDATION_ADMIN", "VALIDATION_CLIENT", "MESURE_SYSTEME", "TEST_AUTOMATISE", "INFERENCE_IA"] as const;
const CONFIANCES_EVIDENCE = ["VERIFIE", "DECLARE", "INFERE", "INCONNU"] as const;

type WorkItem = { id: string; titre: string; description: string | null; statut: string };
type Assignment = { id: string; role: string; statut: string; dateDebut: string | null; dateFin: string | null; missionAssignmentId: string };
type MissionAssignmentOption = { id: string; talentId: string; role: string; statut: string };
type ProfilOption = { id: string; nom: string; prenom?: string | null };
type Version = { id: string; version: number; titre: string; natureContenu: string; statut: string; supersedesId: string | null };
type Deliverable = { id: string; acceptanceCriteria: string | null; versions: Version[] };
type Evidence = { id: string; methode: string; confiance: string; contenu: string; createdByEmail: string; createdAt: string };

function nomIngenieur(p?: ProfilOption): string {
  if (!p) return "—";
  return p.prenom ? `${p.prenom} ${p.nom}` : p.nom;
}

export default function WorkItemDetailPage() {
  const params = useParams<{ id: string; workItemId: string }>();
  const missionId = params.id;
  const workItemId = params.workItemId;

  const [workItem, setWorkItem] = useState<WorkItem | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [evidences, setEvidences] = useState<Evidence[]>([]);
  const [missionAssignments, setMissionAssignments] = useState<MissionAssignmentOption[]>([]);
  const [deliverablesMission, setDeliverablesMission] = useState<Deliverable[]>([]);
  const [profils, setProfils] = useState<ProfilOption[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  function recharger() {
    setChargement(true);
    Promise.all([
      fetch(`/api/missions/${missionId}/work-items/${workItemId}`).then((r) => r.json().then((d) => ({ ok: r.ok, d }))),
      fetch(`/api/missions/${missionId}/work-items/${workItemId}/assignments`).then((r) => (r.ok ? r.json() : { assignments: [] })),
      fetch(`/api/missions/${missionId}/work-items/${workItemId}/deliverables`).then((r) => (r.ok ? r.json() : { deliverables: [] })),
      fetch(`/api/missions/${missionId}/work-items/${workItemId}/evidence`).then((r) => (r.ok ? r.json() : { evidences: [] })),
      fetch(`/api/missions/${missionId}/assignments`).then((r) => (r.ok ? r.json() : { assignments: [] })),
      fetch(`/api/missions/${missionId}/deliverables`).then((r) => (r.ok ? r.json() : { deliverables: [] })),
      fetch("/api/profils").then((r) => (r.ok ? r.json() : { profils: [] })),
    ])
      .then(([wiRes, aRes, dRes, eRes, maRes, dmRes, pRes]) => {
        if (!wiRes.ok) throw new Error(wiRes.d?.error ?? "Erreur de chargement.");
        setWorkItem(wiRes.d);
        setAssignments(aRes.assignments ?? []);
        setDeliverables(dRes.deliverables ?? []);
        setEvidences(eRes.evidences ?? []);
        setMissionAssignments(maRes.assignments ?? []);
        setDeliverablesMission(dmRes.deliverables ?? []);
        setProfils(pRes.profils ?? []);
        setErreur(null);
      })
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }

  useEffect(() => {
    recharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId, workItemId]);

  async function transitionnerWorkItem(action: string, champ?: { raison?: string; raisonResolution?: string; motif?: string }) {
    const res = await fetch(`/api/missions/${missionId}/work-items/${workItemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...champ }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? "Erreur lors de la transition.");
      return;
    }
    recharger();
  }

  function demanderEtTransitionner(action: "bloquer" | "debloquer" | "annuler") {
    if (action === "bloquer") {
      const raison = prompt(`Raison du blocage (${RAISONS_BLOCAGE.join(", ")}) :`);
      if (!raison) return;
      transitionnerWorkItem("bloquer", { raison });
    } else if (action === "debloquer") {
      const raisonResolution = prompt("Raison de la résolution :");
      if (!raisonResolution) return;
      transitionnerWorkItem("debloquer", { raisonResolution });
    } else {
      const motif = prompt("Motif de l'annulation :");
      if (!motif) return;
      transitionnerWorkItem("annuler", { motif });
    }
  }

  // --- Assignment ---
  const [maSelectionnee, setMaSelectionnee] = useState("");
  const [roleAssignment, setRoleAssignment] = useState("EXECUTEUR");
  const [erreurAssignment, setErreurAssignment] = useState<string | null>(null);

  async function creerAssignment(e: FormEvent) {
    e.preventDefault();
    setErreurAssignment(null);
    if (!maSelectionnee) {
      setErreurAssignment("Choisissez une affectation de mission.");
      return;
    }
    const res = await fetch(`/api/missions/${missionId}/work-items/${workItemId}/assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missionAssignmentId: maSelectionnee, role: roleAssignment }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurAssignment(err.error ?? "Erreur lors de la création de l'affectation.");
      return;
    }
    setMaSelectionnee("");
    recharger();
  }

  async function transitionnerAssignment(assignmentId: string, action: "demarrer" | "terminer" | "annuler") {
    let dateFin: string | undefined;
    if (action === "terminer" || action === "annuler") {
      const saisie = prompt("Date de fin (AAAA-MM-JJ), laisser vide si inconnue :");
      if (saisie) dateFin = new Date(saisie).toISOString();
    }
    const res = await fetch(`/api/missions/${missionId}/work-items/${workItemId}/assignments/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, dateFin }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? "Erreur lors de la transition.");
      return;
    }
    recharger();
  }

  // --- Deliverable : lier existant / créer + lier ---
  const [deliverableALier, setDeliverableALier] = useState("");
  const [erreurLien, setErreurLien] = useState<string | null>(null);
  const [afficherCreationDeliverable, setAfficherCreationDeliverable] = useState(false);
  const [titreDeliverable, setTitreDeliverable] = useState("");
  const [natureDeliverable, setNatureDeliverable] = useState<string>("DOCUMENT");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [creationDeliverable, setCreationDeliverable] = useState(false);

  const idsDejaLies = new Set(deliverables.map((d) => d.id));
  const deliverablesDisponibles = deliverablesMission.filter((d) => !idsDejaLies.has(d.id));

  async function lierDeliverable(deliverableId: string) {
    setErreurLien(null);
    const res = await fetch(`/api/missions/${missionId}/deliverables/${deliverableId}/work-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workItemId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurLien(err.error ?? "Erreur lors de la liaison.");
      return;
    }
    setDeliverableALier("");
    recharger();
  }

  async function creerEtLierDeliverable(e: FormEvent) {
    e.preventDefault();
    setErreurLien(null);
    if (!titreDeliverable.trim()) {
      setErreurLien("Le titre est requis.");
      return;
    }
    setCreationDeliverable(true);
    const creation = await fetch(`/api/missions/${missionId}/deliverables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titre: titreDeliverable, natureContenu: natureDeliverable, acceptanceCriteria: acceptanceCriteria || undefined }),
    });
    if (!creation.ok) {
      setCreationDeliverable(false);
      const err = await creation.json().catch(() => ({}));
      setErreurLien(err.error ?? "Erreur lors de la création du Deliverable.");
      return;
    }
    const nouveauDeliverable = await creation.json();
    await lierDeliverable(nouveauDeliverable.id);
    setCreationDeliverable(false);
    setTitreDeliverable("");
    setAcceptanceCriteria("");
    setAfficherCreationDeliverable(false);
  }

  // --- Evidence ---
  const [methodeEvidence, setMethodeEvidence] = useState<string>("VALIDATION_ADMIN");
  const [confianceEvidence, setConfianceEvidence] = useState<string>("");
  const [contenuEvidence, setContenuEvidence] = useState("");
  const [creationEvidence, setCreationEvidence] = useState(false);
  const [erreurEvidence, setErreurEvidence] = useState<string | null>(null);

  async function creerEvidence(e: FormEvent) {
    e.preventDefault();
    setErreurEvidence(null);
    if (!contenuEvidence.trim()) {
      setErreurEvidence("Le contenu est requis.");
      return;
    }
    setCreationEvidence(true);
    const res = await fetch(`/api/missions/${missionId}/work-items/${workItemId}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ methode: methodeEvidence, confiance: confianceEvidence || undefined, contenu: contenuEvidence }),
    });
    setCreationEvidence(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setErreurEvidence(err.error ?? "Erreur lors de la création de l'Evidence.");
      return;
    }
    setContenuEvidence("");
    setConfianceEvidence("");
    recharger();
  }

  if (chargement) return <p style={{ color: "#888" }}>Chargement…</p>;
  if (erreur || !workItem) return <p style={{ color: rouge }}>{erreur ?? "WorkItem introuvable."}</p>;

  const estTerminal = workItem.statut === "TERMINE" || workItem.statut === "ANNULE";

  return (
    <div>
      <Link href={`/admin/missions/${missionId}/work-items`} style={{ color: bleu, fontSize: 13 }}>← Tous les WorkItems</Link>
      <h1 style={{ marginTop: 8, marginBottom: 4, color: bleuFonce }}>{workItem.titre}</h1>
      <p style={{ fontSize: 13, color: grisTexte, marginBottom: 4 }}>Statut : <strong>{workItem.statut}</strong></p>
      {workItem.description && <p style={{ fontSize: 13, color: grisTexte, marginBottom: 16 }}>{workItem.description}</p>}

      {!estTerminal && (
        <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
          {workItem.statut === "A_FAIRE" && (
            <button onClick={() => transitionnerWorkItem("demarrer")} style={{ fontSize: 12, padding: "4px 10px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Démarrer</button>
          )}
          {workItem.statut === "EN_COURS" && (
            <>
              <button onClick={() => demanderEtTransitionner("bloquer")} style={{ fontSize: 12, padding: "4px 10px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Bloquer</button>
              <button onClick={() => transitionnerWorkItem("terminer")} style={{ fontSize: 12, padding: "4px 10px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Terminer</button>
            </>
          )}
          {workItem.statut === "BLOQUE" && (
            <>
              <button onClick={() => demanderEtTransitionner("debloquer")} style={{ fontSize: 12, padding: "4px 10px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Débloquer</button>
              <button onClick={() => transitionnerWorkItem("terminer")} style={{ fontSize: 12, padding: "4px 10px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Terminer</button>
            </>
          )}
          <button onClick={() => demanderEtTransitionner("annuler")} style={{ fontSize: 12, padding: "4px 10px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Annuler</button>
        </div>
      )}

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Affectation</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
              <th style={{ padding: "6px 8px" }}>Talent</th>
              <th style={{ padding: "6px 8px" }}>Rôle</th>
              <th style={{ padding: "6px 8px" }}>Statut</th>
              <th style={{ padding: "6px 8px" }}></th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => {
              const ma = missionAssignments.find((m) => m.id === a.missionAssignmentId);
              const profil = ma ? profils.find((p) => p.id === ma.talentId) : undefined;
              return (
                <tr key={a.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 8px" }}>{nomIngenieur(profil)}</td>
                  <td style={{ padding: "6px 8px" }}>{a.role}</td>
                  <td style={{ padding: "6px 8px" }}>{a.statut}</td>
                  <td style={{ padding: "6px 8px", display: "flex", gap: 6 }}>
                    {a.statut === "PLANIFIE" && <button onClick={() => transitionnerAssignment(a.id, "demarrer")} style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Démarrer</button>}
                    {a.statut === "ACTIF" && <button onClick={() => transitionnerAssignment(a.id, "terminer")} style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Terminer</button>}
                    {(a.statut === "PLANIFIE" || a.statut === "ACTIF") && <button onClick={() => transitionnerAssignment(a.id, "annuler")} style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>Annuler</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {assignments.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>Aucune affectation.</p>}

        {!estTerminal && (
          <form onSubmit={creerAssignment} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
            <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              Affectation Mission
              <select value={maSelectionnee} onChange={(e) => setMaSelectionnee(e.target.value)} style={{ padding: 6, minWidth: 200 }}>
                <option value="">Choisir…</option>
                {missionAssignments.map((ma) => {
                  const profil = profils.find((p) => p.id === ma.talentId);
                  return <option key={ma.id} value={ma.id}>{nomIngenieur(profil)} ({ma.role})</option>;
                })}
              </select>
            </label>
            <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              Rôle sur ce WorkItem
              <select value={roleAssignment} onChange={(e) => setRoleAssignment(e.target.value)} style={{ padding: 6 }}>
                <option value="EXECUTEUR">EXECUTEUR</option>
                <option value="CONTRIBUTEUR">CONTRIBUTEUR</option>
                <option value="REVIEWER">REVIEWER</option>
              </select>
            </label>
            <button type="submit" style={{ padding: "6px 14px", fontWeight: 600 }}>Affecter</button>
            {erreurAssignment && <p style={{ fontSize: 12, color: rouge, width: "100%", margin: 0 }}>{erreurAssignment}</p>}
          </form>
        )}
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Deliverables</h2>
        {deliverables.map((d) => {
          const courante = d.versions.find((v) => !d.versions.some((autre) => autre.supersedesId === v.id));
          return (
            <div key={d.id} style={{ padding: 10, border: `1px solid ${bordure}`, marginBottom: 8 }}>
              <Link href={`/admin/missions/${missionId}/deliverables/${d.id}`} style={{ color: bleu, fontSize: 13, fontWeight: 600 }}>
                {courante?.titre ?? "(sans version)"}
              </Link>
              {courante && <span style={{ fontSize: 11, color: grisTexte, marginLeft: 8 }}>v{courante.version} · {courante.statut}</span>}
            </div>
          );
        })}
        {deliverables.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>Aucun Deliverable lié à ce WorkItem.</p>}

        {!estTerminal && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {deliverablesDisponibles.length > 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                  Lier un Deliverable existant de la mission
                  <select value={deliverableALier} onChange={(e) => setDeliverableALier(e.target.value)} style={{ padding: 6, minWidth: 220 }}>
                    <option value="">Choisir…</option>
                    {deliverablesDisponibles.map((d) => (
                      <option key={d.id} value={d.id}>{d.versions[0]?.titre ?? d.id}</option>
                    ))}
                  </select>
                </label>
                <button onClick={() => deliverableALier && lierDeliverable(deliverableALier)} disabled={!deliverableALier} style={{ padding: "6px 14px", fontWeight: 600 }}>Lier</button>
              </div>
            )}
            <button
              onClick={() => setAfficherCreationDeliverable((v) => !v)}
              style={{ padding: "6px 14px", fontWeight: 600, border: `1px solid ${bordure}`, background: "#fff", color: bleuFonce, cursor: "pointer", width: "fit-content" }}
            >
              {afficherCreationDeliverable ? "Annuler" : "+ Nouveau Deliverable (lié automatiquement)"}
            </button>
            {afficherCreationDeliverable && (
              <form onSubmit={creerEtLierDeliverable} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
                <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
                  Titre
                  <input value={titreDeliverable} onChange={(e) => setTitreDeliverable(e.target.value)} style={{ padding: 6 }} />
                </label>
                <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                  Nature du contenu
                  <select value={natureDeliverable} onChange={(e) => setNatureDeliverable(e.target.value)} style={{ padding: 6 }}>
                    {NATURES_CONTENU.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
                  Critères d&apos;acceptation (optionnel)
                  <input value={acceptanceCriteria} onChange={(e) => setAcceptanceCriteria(e.target.value)} style={{ padding: 6 }} />
                </label>
                <button type="submit" disabled={creationDeliverable} style={{ padding: "6px 14px", fontWeight: 600 }}>
                  {creationDeliverable ? "Création…" : "Créer et lier"}
                </button>
              </form>
            )}
            {erreurLien && <p style={{ fontSize: 12, color: rouge, margin: 0 }}>{erreurLien}</p>}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Evidence</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
              <th style={{ padding: "6px 8px" }}>Méthode</th>
              <th style={{ padding: "6px 8px" }}>Confiance</th>
              <th style={{ padding: "6px 8px" }}>Contenu</th>
              <th style={{ padding: "6px 8px" }}>Par</th>
            </tr>
          </thead>
          <tbody>
            {evidences.map((e) => (
              <tr key={e.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 8px" }}>{e.methode}</td>
                <td style={{ padding: "6px 8px" }}>{e.confiance}</td>
                <td style={{ padding: "6px 8px" }}>{e.contenu}</td>
                <td style={{ padding: "6px 8px", fontSize: 11, color: grisTexte }}>{e.createdByEmail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {evidences.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>Aucune Evidence.</p>}

        <form onSubmit={creerEvidence} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginTop: 12 }}>
          <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            Méthode
            <select value={methodeEvidence} onChange={(e) => setMethodeEvidence(e.target.value)} style={{ padding: 6 }}>
              {METHODES_EVIDENCE.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            Confiance (optionnel, défaut serveur sinon)
            <select value={confianceEvidence} onChange={(e) => setConfianceEvidence(e.target.value)} style={{ padding: 6 }}>
              <option value="">(défaut)</option>
              {CONFIANCES_EVIDENCE.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 220 }}>
            Contenu (assertion factuelle)
            <input value={contenuEvidence} onChange={(e) => setContenuEvidence(e.target.value)} style={{ padding: 6 }} />
          </label>
          <button type="submit" disabled={creationEvidence} style={{ padding: "6px 14px", fontWeight: 600 }}>
            {creationEvidence ? "Ajout…" : "Ajouter"}
          </button>
          {erreurEvidence && <p style={{ fontSize: 12, color: rouge, width: "100%", margin: 0 }}>{erreurEvidence}</p>}
        </form>
      </section>
    </div>
  );
}
