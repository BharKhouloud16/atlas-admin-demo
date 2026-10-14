"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bleuFonce, bleu, grisTexte, bordure, rouge, vert, orange } from "@/lib/theme";

// COMPANY ATLAS — DB-06 : Agentic Runtime UI (08/10/2026).
//
// Consomme STRICTEMENT GET /api/agentic-runs (voir route.ts — seul ajout
// backend de ce lot, lecture seule, ADMIN-only, additif). Aucun nouveau
// statut frontend : les 9 valeurs affichées ci-dessous sont EXACTEMENT
// AgenticRunStatut (A32, inchangé). Filtre par statut délégué au paramètre
// `statut` déjà supporté par la route — jamais un filtre reconstruit
// côté client sur un jeu de données partiel.

type RunLigne = {
  id: string;
  loopType: string;
  declaredAction: string;
  declaredScope: string;
  goal: string;
  missionId: string | null;
  statut: string;
  createdAt: string;
  createdByEmail: string;
  createdByRole: string;
  startedAt: string | null;
  pausedAt: string | null;
  resumedAt: string | null;
  completedAt: string | null;
};

const STATUTS: string[] = ["DRAFT", "READY", "RUNNING", "WAITING_APPROVAL", "PAUSED", "SUCCEEDED", "FAILED", "STOPPED", "ESCALATED"];
const TOUS = "TOUS";

const COULEUR_STATUT: Record<string, string> = {
  DRAFT: grisTexte,
  READY: bleu,
  RUNNING: bleu,
  WAITING_APPROVAL: orange,
  PAUSED: orange,
  SUCCEEDED: vert,
  FAILED: rouge,
  STOPPED: rouge,
  ESCALATED: rouge,
};

function Badge({ valeur }: { valeur: string }) {
  const couleur = COULEUR_STATUT[valeur] ?? grisTexte;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur, whiteSpace: "nowrap" }}>{valeur}</span>;
}

// "Dernière activité" : la plus récente des dates RÉELLEMENT persistées
// (startedAt/pausedAt/resumedAt/completedAt/createdAt) — AgenticRun ne
// possède aucun champ `updatedAt` générique (contrat A32, schéma
// inchangé) ; jamais un champ inventé, uniquement un max() de valeurs
// existantes, affiché sous un libellé qui ne prétend pas être un champ
// backend.
function derniereActivite(run: RunLigne): string {
  const dates = [run.completedAt, run.resumedAt, run.pausedAt, run.startedAt, run.createdAt].filter((d): d is string => !!d);
  const plusRecente = dates.map((d) => new Date(d).getTime()).reduce((a, b) => Math.max(a, b), 0);
  return new Date(plusRecente).toLocaleString("fr-FR");
}

export default function AgenticRunsListePage() {
  const [runs, setRuns] = useState<RunLigne[]>([]);
  const [filtreStatut, setFiltreStatut] = useState(TOUS);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  function charger(statut: string) {
    setChargement(true);
    const url = statut === TOUS ? "/api/agentic-runs" : `/api/agentic-runs?statut=${encodeURIComponent(statut)}`;
    fetch(url)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error ?? `Erreur ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        setRuns(d.runs ?? []);
        setErreur(null);
      })
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }

  useEffect(() => {
    charger(filtreStatut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtreStatut]);

  if (chargement) return <p style={{ color: "#888" }}>Chargement…</p>;
  if (erreur) return <p style={{ color: rouge }}>{erreur}</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0, marginBottom: 4, color: bleuFonce }}>Agentic Runtime — Runs</h1>
      <p style={{ fontSize: 13, color: grisTexte, marginBottom: 16 }}>
        Consultation et contrôle des Agentic Runs (A32) — démarrage, pause, reprise et arrêt restent strictement ceux déjà
        autorisés par le Runtime ; aucune nouvelle action n&apos;est introduite par cet écran.
      </p>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16, padding: 10, border: `1px solid ${bordure}` }}>
        <label style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 2 }}>
          Statut
          <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)} style={{ padding: 4 }}>
            <option value={TOUS}>Tous</option>
            {STATUTS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
              <th style={{ padding: "6px 8px" }}>Run</th>
              <th style={{ padding: "6px 8px" }}>Mission</th>
              <th style={{ padding: "6px 8px" }}>Type / intention</th>
              <th style={{ padding: "6px 8px" }}>Statut</th>
              <th style={{ padding: "6px 8px" }}>Créé le</th>
              <th style={{ padding: "6px 8px" }}>Dernière activité</th>
              <th style={{ padding: "6px 8px" }}>Créé par</th>
              <th style={{ padding: "6px 8px" }}></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 8px" }}><code style={{ fontSize: 12 }}>{r.id.slice(0, 10)}…</code></td>
                <td style={{ padding: "6px 8px" }}>{r.missionId ? <code style={{ fontSize: 12 }}>{r.missionId.slice(0, 10)}…</code> : <span style={{ color: "#888" }}>—</span>}</td>
                <td style={{ padding: "6px 8px" }}>
                  {r.loopType} — {r.declaredAction}/{r.declaredScope}
                  <div style={{ fontSize: 11, color: grisTexte, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.goal}</div>
                </td>
                <td style={{ padding: "6px 8px" }}><Badge valeur={r.statut} /></td>
                <td style={{ padding: "6px 8px", fontSize: 12, color: grisTexte }}>{new Date(r.createdAt).toLocaleString("fr-FR")}</td>
                <td style={{ padding: "6px 8px", fontSize: 12, color: grisTexte }}>{derniereActivite(r)}</td>
                <td style={{ padding: "6px 8px", fontSize: 12 }}>{r.createdByEmail}</td>
                <td style={{ padding: "6px 8px" }}>
                  <Link href={`/admin/agentic-runs/${r.id}`} style={{ color: bleu, fontSize: 12 }}>Ouvrir →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {runs.length === 0 && <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Aucun Agentic Run{filtreStatut !== TOUS ? ` au statut ${filtreStatut}` : ""}.</p>}
      </div>
    </div>
  );
}
