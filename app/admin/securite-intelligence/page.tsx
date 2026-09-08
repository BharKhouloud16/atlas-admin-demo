"use client";

import { useEffect, useState } from "react";
import { bleuFonce, grisTexte, bordure } from "@/lib/theme";

// ATLAS OS — TRUST & SECURITY INTELLIGENCE FOUNDATION (Batch 16, 08/09/2026).
// Page Admin en lecture seule pour les événements/signaux/risques, avec un
// seul point d'action : décider (approuver/rejeter) une proposition —
// jamais d'application automatique (voir app/api/security/propositions).
// Réservé Admin (protégé par app/admin/layout.tsx + middleware.ts, comme
// le reste de /admin).

type Evenement = {
  id: string;
  action: string;
  resultat: string;
  severite: string;
  acteurEmail: string | null;
  contexteIp: string | null;
  detail: string | null;
  createdAt: string;
};

type Signal = { regle: string; titre: string; statut: string; fait: string; explication: string };
type Risque = { signalRegle: string; niveau: string; risque: string | null };
type Proposition = {
  id: string;
  origine: string;
  titre: string;
  description: string;
  statut: string;
  proposeLe: string;
  decideParEmail: string | null;
  motifDecision: string | null;
};

const badge = (couleur: string, fond: string): React.CSSProperties => ({
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  color: couleur,
  background: fond,
});

function badgeResultat(resultat: string) {
  if (resultat === "SUCCES") return badge("#166534", "#dcfce7");
  if (resultat === "REFUSE") return badge("#92400e", "#fef3c7");
  return badge("#991b1b", "#fee2e2");
}

function badgeStatutSignal(statut: string) {
  if (statut === "SIGNAL_DETECTE") return badge("#991b1b", "#fee2e2");
  if (statut === "UNKNOWN") return badge("#475569", "#e2e8f0");
  return badge("#166534", "#dcfce7");
}

export default function SecuriteIntelligencePage() {
  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [signaux, setSignaux] = useState<Signal[]>([]);
  const [risques, setRisques] = useState<Risque[]>([]);
  const [propositions, setPropositions] = useState<Proposition[]>([]);
  const [chargement, setChargement] = useState(true);
  const [motifParId, setMotifParId] = useState<Record<string, string>>({});

  function recharger() {
    Promise.all([
      fetch("/api/security/evenements?limite=50").then((r) => (r.ok ? r.json() : { evenements: [] })),
      fetch("/api/security/runtime").then((r) => (r.ok ? r.json() : { signaux: [], risques: [] })),
      fetch("/api/security/propositions").then((r) => (r.ok ? r.json() : { propositions: [] })),
    ]).then(([e, s, p]) => {
      setEvenements(e.evenements ?? []);
      setSignaux(s.signaux ?? []);
      setRisques(s.risques ?? []);
      setPropositions(p.propositions ?? []);
      setChargement(false);
    });
  }

  useEffect(() => {
    recharger();
  }, []);

  async function decider(id: string, decision: "APPROUVEE" | "REJETEE") {
    const motifDecision = (motifParId[id] ?? "").trim();
    if (!motifDecision) {
      alert("Un motif de décision est requis.");
      return;
    }
    const res = await fetch(`/api/security/propositions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, motifDecision }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error ?? "Erreur lors de la décision");
      return;
    }
    recharger();
  }

  if (chargement) return <p style={{ fontSize: 13, color: grisTexte }}>Chargement...</p>;

  return (
    <div>
      <h1 style={{ marginBottom: 4, color: bleuFonce }}>Sécurité — Intelligence runtime</h1>
      <p style={{ fontSize: 13, color: grisTexte, marginBottom: 20, maxWidth: 760 }}>
        Événements de sécurité réels (connexions, génération de contrats, refus d'accès), signaux calculés par règles
        explicites, et propositions d'amélioration en attente de décision humaine — aucune application automatique.
      </p>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Signaux (15 dernières minutes, fenêtre glissante)</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
                <th style={{ padding: "6px 8px" }}>Règle</th>
                <th style={{ padding: "6px 8px" }}>Statut</th>
                <th style={{ padding: "6px 8px" }}>Fait observé</th>
                <th style={{ padding: "6px 8px" }}>Niveau de risque</th>
              </tr>
            </thead>
            <tbody>
              {signaux.map((s) => {
                const risque = risques.find((r) => r.signalRegle === s.regle);
                return (
                  <tr key={s.regle} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "6px 8px" }}>{s.titre}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <span style={badgeStatutSignal(s.statut)}>{s.statut}</span>
                    </td>
                    <td style={{ padding: "6px 8px" }}>{s.fait}</td>
                    <td style={{ padding: "6px 8px" }}>{risque?.niveau ?? "UNKNOWN"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Propositions d'amélioration (validation humaine requise)</h2>
        {propositions.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>Aucune proposition pour l'instant.</p>}
        {propositions.map((p) => (
          <div key={p.id} style={{ border: `1px solid ${bordure}`, padding: 12, marginBottom: 8, borderRadius: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <strong style={{ fontSize: 13 }}>{p.titre}</strong>
              <span style={{ fontSize: 11, color: grisTexte }}>{p.statut}</span>
            </div>
            <p style={{ fontSize: 12, color: grisTexte, margin: "4px 0" }}>{p.description}</p>
            <p style={{ fontSize: 11, color: "#94a3b8" }}>Origine : {p.origine}</p>
            {p.statut === "PROPOSEE" ? (
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <input
                  placeholder="Motif de la décision"
                  value={motifParId[p.id] ?? ""}
                  onChange={(e) => setMotifParId((m) => ({ ...m, [p.id]: e.target.value }))}
                  style={{ padding: 6, fontSize: 12, flex: 1 }}
                />
                <button onClick={() => decider(p.id, "APPROUVEE")} style={{ padding: "6px 10px", fontSize: 12 }}>
                  Approuver
                </button>
                <button onClick={() => decider(p.id, "REJETEE")} style={{ padding: "6px 10px", fontSize: 12 }}>
                  Rejeter
                </button>
              </div>
            ) : (
              <p style={{ fontSize: 11, color: grisTexte }}>
                Décidé par {p.decideParEmail} — {p.motifDecision}
              </p>
            )}
          </div>
        ))}
      </section>

      <section>
        <h2 style={{ fontSize: 15, color: bleuFonce, marginBottom: 8 }}>Derniers événements de sécurité</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
                <th style={{ padding: "6px 8px" }}>Horodatage</th>
                <th style={{ padding: "6px 8px" }}>Action</th>
                <th style={{ padding: "6px 8px" }}>Résultat</th>
                <th style={{ padding: "6px 8px" }}>Acteur</th>
                <th style={{ padding: "6px 8px" }}>Détail</th>
              </tr>
            </thead>
            <tbody>
              {evenements.map((e) => (
                <tr key={e.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 8px" }}>{new Date(e.createdAt).toLocaleString("fr-FR")}</td>
                  <td style={{ padding: "6px 8px" }}>{e.action}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <span style={badgeResultat(e.resultat)}>{e.resultat}</span>
                  </td>
                  <td style={{ padding: "6px 8px" }}>{e.acteurEmail ?? e.contexteIp ?? "—"}</td>
                  <td style={{ padding: "6px 8px" }}>{e.detail ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {evenements.length === 0 && <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Aucun événement pour l'instant.</p>}
        </div>
      </section>
    </div>
  );
}
