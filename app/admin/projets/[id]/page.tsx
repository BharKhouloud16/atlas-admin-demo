"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { bleu, bordure, grisTexte, rouge, vert } from "@/lib/theme";
import { LIBELLE_STATUT_PROJET, type StatutProjetValeur } from "@/lib/projet/regles";

// LOT 6 (28/10/2026) — fiche ADMIN d'un projet : qualification, propositions
// versionnées (indicative puis vérifiée), engagement, missions rattachées.
// Rien n'est engagé automatiquement : chaque étape est une action explicite.

type Detail = {
  id: string;
  titre: string;
  type: string;
  statut: StatutProjetValeur;
  objectif: string;
  resultatAttendu: string;
  perimetre: string | null;
  contraintes: string | null;
  exigencesTechniques: string | null;
  calendrierSouhaite: string | null;
  budgetIndicatif: string | null;
  manquants: { requises: string[]; utiles: string[] };
  competencesIdentifiees: string[];
  propositions: { id: string; version: number; niveau: string; statut: string; approche: string; delaiEstime: string | null; budgetEstimeMin: number | null; budgetEstimeMax: number | null }[];
  evenements: { id: string; type: string; detail: string | null; auteur: string; le: string; statutTraitement: string | null }[];
  missions: { id: string; repere: string | null; statut: string }[];
  client: { id: string; nom: string };
};

type MissionLigne = { id: string; repere: string | null; statut: string; clientId?: string; client?: { id?: string; nom?: string } };

const TRANSITIONS_ADMIN: Partial<Record<StatutProjetValeur, { vers: StatutProjetValeur; libelle: string }[]>> = {
  A_QUALIFIER: [{ vers: "QUALIFIE", libelle: "Qualifier le projet" }],
  ACCEPTEE: [{ vers: "ENGAGEMENT_CONFIRME", libelle: "Confirmer l'engagement" }],
  ENGAGEMENT_CONFIRME: [{ vers: "EN_COURS", libelle: "Démarrer le projet" }],
  EN_COURS: [{ vers: "TERMINE", libelle: "Terminer le projet" }],
};

const champ = { width: "100%", padding: 6, borderRadius: 6, border: `1px solid ${bordure}`, fontFamily: "inherit", fontSize: 13, boxSizing: "border-box" as const };

export default function ProjetAdminDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<Detail | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [missions, setMissions] = useState<MissionLigne[]>([]);

  function charger() {
    fetch(`/api/projets/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setP(d.projet))
      .catch(() => setErreur("Impossible de charger le projet."));
  }
  useEffect(charger, [id]);
  useEffect(() => {
    fetch("/api/missions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setMissions(Array.isArray(d) ? d : d.missions ?? []))
      .catch(() => setMissions([]));
  }, []);

  async function appeler(url: string, methode: string, corps: unknown) {
    setErreur(null);
    const r = await fetch(url, { method: methode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    if (!r.ok) setErreur((await r.json().catch(() => ({}))).error ?? "Une erreur est survenue.");
    charger();
    return r.ok;
  }

  if (!p) return <p>{erreur ?? "Chargement…"}</p>;
  const missionsClient = missions.filter((m) => (m.clientId ?? m.client?.id) === p.client.id && !p.missions.some((x) => x.id === m.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ margin: 0 }}><Link href="/admin/projets">← Projets</Link></p>
      <h1 style={{ fontSize: 20, margin: 0 }}>{p.titre}</h1>
      <p style={{ margin: 0, color: grisTexte }}>{p.client.nom} · {p.type === "SERVICE_ATLAS_OS" ? "Prestation ATLAS OS" : "Projet de delivery"} · <strong>{LIBELLE_STATUT_PROJET[p.statut]}</strong></p>
      {erreur && <p role="alert" style={{ color: rouge }}>{erreur}</p>}

      <section style={{ background: "#fff", border: `1px solid ${bordure}`, borderRadius: 8, padding: 12, fontSize: 13 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Expression du client</h2>
        {(
          [
            ["Objectif", p.objectif],
            ["Résultat attendu", p.resultatAttendu],
            ["Périmètre", p.perimetre],
            ["Exigences techniques", p.exigencesTechniques],
            ["Contraintes", p.contraintes],
            ["Calendrier", p.calendrierSouhaite],
            ["Budget indicatif", p.budgetIndicatif],
          ] as const
        ).map(([k, v]) => (
          <p key={k} style={{ margin: "0 0 4px" }}><strong>{k} :</strong> {v ?? <em style={{ color: grisTexte }}>non renseigné</em>}</p>
        ))}
        {p.competencesIdentifiees.length > 0 && <p style={{ margin: "6px 0 0", color: grisTexte }}>Compétences identifiées : {p.competencesIdentifiees.join(", ")}</p>}
        {p.manquants.requises.length > 0 && <p style={{ margin: "6px 0 0", color: rouge }}>Manquant pour qualifier : {p.manquants.requises.join(", ")}</p>}
      </section>

      <section style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(TRANSITIONS_ADMIN[p.statut] ?? []).map((t) => (
          <button key={t.vers} onClick={() => appeler(`/api/projets/${p.id}`, "PATCH", { statut: t.vers })} style={{ background: bleu, color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>
            {t.libelle}
          </button>
        ))}
        {!["ENGAGEMENT_CONFIRME", "EN_COURS", "TERMINE", "ABANDONNE"].includes(p.statut) && (
          <button
            onClick={() => {
              const motif = window.prompt("Motif de l'abandon (visible par le client) :");
              if (motif !== null) appeler(`/api/projets/${p.id}`, "PATCH", { statut: "ABANDONNE", motif });
            }}
            style={{ background: "#fff", color: rouge, border: `1px solid ${rouge}`, borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}
          >
            Abandonner
          </button>
        )}
      </section>

      {["QUALIFIE", "PROPOSITION_INDICATIVE", "PROPOSITION_VERIFIEE"].includes(p.statut) && <FormulaireProposition projetId={p.id} publier={appeler} />}

      <section style={{ background: "#fff", border: `1px solid ${bordure}`, borderRadius: 8, padding: 12, fontSize: 13 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Propositions</h2>
        {p.propositions.length === 0 ? (
          <p style={{ color: grisTexte }}>Aucune proposition.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {p.propositions.map((x) => (
              <li key={x.id}>
                v{x.version} · {x.niveau === "VERIFIEE" ? "vérifiée" : "indicative"} · {x.statut.toLowerCase()} — {x.approche.slice(0, 80)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {(p.statut === "ENGAGEMENT_CONFIRME" || p.statut === "EN_COURS") && (
        <section style={{ background: "#fff", border: `1px solid ${bordure}`, borderRadius: 8, padding: 12, fontSize: 13 }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Missions du projet</h2>
          <p style={{ color: grisTexte, margin: "0 0 8px" }}>
            Créez la mission de chaque profil engagé avec l&apos;outil habituel (<Link href="/admin/missions">Missions</Link>), puis rattachez-la ici.
          </p>
          <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>{p.missions.map((m) => <li key={m.id}>{m.repere ?? m.id} · {m.statut}</li>)}</ul>
          {missionsClient.length > 0 && (
            <select defaultValue="" onChange={(e) => e.target.value && appeler(`/api/projets/${p.id}/missions`, "POST", { missionId: e.target.value })} style={champ}>
              <option value="">Rattacher une mission de ce client…</option>
              {missionsClient.map((m) => (
                <option key={m.id} value={m.id}>{m.repere ?? m.id} · {m.statut}</option>
              ))}
            </select>
          )}
        </section>
      )}

      <section style={{ fontSize: 13 }}>
        <h2 style={{ fontSize: 15 }}>Historique</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {p.evenements.map((e) => (
            <li key={e.id}>
              {new Date(e.le).toLocaleString("fr-FR")} — {e.type} — {e.auteur}
              {e.detail ? ` — ${e.detail}` : ""}
              {e.statutTraitement ? (
                <>
                  {" "}— demande {e.statutTraitement === "ENVOYEE" ? "à traiter" : e.statutTraitement === "PRISE_EN_CHARGE" ? "prise en charge" : "clôturée"} (
                  <a href="/admin/demandes-clients">Demandes clients</a>)
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function FormulaireProposition({ projetId, publier }: { projetId: string; publier: (url: string, methode: string, corps: unknown) => Promise<boolean> }) {
  const [f, setF] = useState({ niveau: "INDICATIVE", approche: "", perimetre: "", equipe: "", etapes: "", delaiEstime: "", budgetEstimeMin: "", budgetEstimeMax: "", hypotheses: "", exclusions: "" });
  const lignes = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
  async function envoyer() {
    const ok = await publier(`/api/projets/${projetId}/propositions`, "POST", {
      niveau: f.niveau,
      approche: f.approche,
      perimetre: f.perimetre,
      // Une ligne par rôle : « 2 | Ingénieur QA automation | Playwright, Cypress »
      equipe: lignes(f.equipe).map((l) => {
        const [nombre, role, competences] = l.split("|").map((x) => x.trim());
        return { nombre: Number(nombre), role, competences: (competences ?? "").split(",").map((c) => c.trim()).filter(Boolean) };
      }),
      // Une ligne par étape : « Cadrage | 2 semaines | Plan de test, Stratégie »
      etapes: lignes(f.etapes).map((l) => {
        const [nom, duree, livrables] = l.split("|").map((x) => x.trim());
        return { nom, dureeEstimee: duree || null, livrables: (livrables ?? "").split(",").map((c) => c.trim()).filter(Boolean) };
      }),
      delaiEstime: f.delaiEstime,
      budgetEstimeMin: f.budgetEstimeMin,
      budgetEstimeMax: f.budgetEstimeMax,
      hypotheses: lignes(f.hypotheses),
      exclusions: lignes(f.exclusions),
    });
    if (ok) setF({ ...f, approche: "", perimetre: "" });
  }
  const zone = (k: keyof typeof f, l: string, aide?: string) => (
    <label style={{ display: "block", fontSize: 12, color: grisTexte }}>
      {l}
      <textarea value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} rows={2} style={{ ...champ, marginTop: 2 }} />
      {aide && <span style={{ fontSize: 11 }}>{aide}</span>}
    </label>
  );
  return (
    <section style={{ background: "#fff", border: `1px solid ${bordure}`, borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ fontSize: 15, margin: 0 }}>Publier une proposition</h2>
      <label style={{ fontSize: 12, color: grisTexte }}>
        Niveau{" "}
        <select value={f.niveau} onChange={(e) => setF({ ...f, niveau: e.target.value })} style={{ ...champ, width: "auto" }}>
          <option value="INDICATIVE">Indicative (estimation, hypothèses obligatoires)</option>
          <option value="VERIFIEE">Vérifiée (équipe, délai et budget confirmés)</option>
        </select>
      </label>
      {zone("approche", "Approche")}
      {zone("perimetre", "Périmètre")}
      {zone("equipe", "Équipe envisagée", "Une ligne par rôle : nombre | rôle | compétences séparées par des virgules")}
      {zone("etapes", "Étapes", "Une ligne par étape : nom | durée estimée | livrables séparés par des virgules")}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: grisTexte }}>Délai<input value={f.delaiEstime} onChange={(e) => setF({ ...f, delaiEstime: e.target.value })} style={champ} /></label>
        <label style={{ fontSize: 12, color: grisTexte }}>Budget min (EUR)<input inputMode="decimal" value={f.budgetEstimeMin} onChange={(e) => setF({ ...f, budgetEstimeMin: e.target.value })} style={champ} /></label>
        <label style={{ fontSize: 12, color: grisTexte }}>Budget max (EUR)<input inputMode="decimal" value={f.budgetEstimeMax} onChange={(e) => setF({ ...f, budgetEstimeMax: e.target.value })} style={champ} /></label>
      </div>
      {zone("hypotheses", "Hypothèses", "Une par ligne")}
      {zone("exclusions", "Exclusions", "Une par ligne")}
      <button onClick={envoyer} style={{ alignSelf: "flex-start", background: vert, color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>
        Publier la proposition
      </button>
    </section>
  );
}
