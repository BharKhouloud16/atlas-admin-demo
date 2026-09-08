"use client";

import { useEffect, useState, FormEvent } from "react";
import { bleuFonce, grisTexte, bordure } from "@/lib/theme";

type Mission = {
  id: string;
  repere: string | null;
  nbJours: number;
  statut: string;
  tjmVente?: number;
  ca?: number | null;
  margeEuros?: number | null;
  margePct?: number | null;
  client: { nom: string };
  profil?: { nom: string; prenom?: string | null };
};

type ClientOption = { id: string; nom: string };
type ProfilOption = { id: string; nom: string; prenom?: string | null };

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

  function rechargerMissions() {
    return fetch("/api/missions")
      .then((r) => r.json())
      .then((data) => {
        setMissions(data);
        return data;
      });
  }

  useEffect(() => {
    rechargerMissions();

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
      } else {
        setRole("INGENIEUR");
      }
    }).catch(() => {});
  }, []);

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
    setAfficherFormulaire(false);
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
                <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ padding: 6, minWidth: 180 }}>
                  <option value="">Choisir...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
              </label>
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

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
              <th style={{ padding: "6px 8px" }}>Client</th>
              <th style={{ padding: "6px 8px" }}>Ingénieur</th>
              <th style={{ padding: "6px 8px" }}>Repère</th>
              <th style={{ padding: "6px 8px" }}>Jours</th>
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
              <tr key={m.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 8px" }}>{m.client.nom}</td>
                <td style={{ padding: "6px 8px" }}>{nomIngenieur(m.profil)}</td>
                <td style={{ padding: "6px 8px" }}>{m.repere ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>{m.nbJours}</td>
                <td style={{ padding: "6px 8px" }}>{m.statut}</td>
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
            ))}
          </tbody>
        </table>
        {missions.length === 0 && (
          <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Aucune mission pour l'instant.</p>
        )}
      </div>
    </div>
  );
}
