"use client";

import { useEffect, useState } from "react";
import { bleu } from "@/lib/theme";
import { libelleMois, type StatutCra } from "@/lib/feuilles-de-temps";

type Mission = {
  id: string;
  repere: string | null;
  statut: string;
  nbJours: number;
  createdAt: string;
  profil: { nom: string };
};

type Document = {
  id: string;
  titre: string;
  type: string;
  fileUrl: string;
  createdAt: string;
};

type FeuilleClient = {
  id: string;
  mois: string;
  joursTravailles: number;
  heuresSupplementaires: number;
  statut: StatutCra;
  mission: { id: string; repere: string | null; profil: { nom: string } };
};

type MissionEvaluable = {
  id: string;
  repere: string | null;
  profil: { nom: string };
  evaluation: { note: number; commentaire: string | null } | null;
};

export default function ClientDashboard() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [feuilles, setFeuilles] = useState<FeuilleClient[]>([]);
  const [missionsEvaluables, setMissionsEvaluables] = useState<MissionEvaluable[]>([]);

  function rechargerFeuilles() {
    fetch("/api/feuilles-de-temps").then((r) => r.json()).then((d) => setFeuilles(d.feuilles ?? []));
  }
  function rechargerEvaluations() {
    fetch("/api/evaluations").then((r) => r.json()).then((d) => setMissionsEvaluables(d.missions ?? []));
  }

  useEffect(() => {
    fetch("/api/client/missions").then((r) => r.json()).then(setMissions);
    fetch("/api/client/documents").then((r) => r.json()).then(setDocuments);
    rechargerFeuilles();
    rechargerEvaluations();
  }, []);

  const feuillesAValider = feuilles.filter((f) => f.statut === "ValideeAdmin");

  return (
    <div>
      <FeuillesATraiter feuilles={feuillesAValider} recharger={rechargerFeuilles} />
      <EvaluationsAFaire missions={missionsEvaluables} recharger={rechargerEvaluations} />

      <h1>Suivi de vos missions</h1>
      {missions.length === 0 && <p style={{ color: "#888" }}>Aucune mission pour l'instant.</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {missions.map((m) => (
          <li key={m.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{m.repere ?? m.profil.nom}</p>
            <p style={{ margin: 0, fontSize: 13, color: "#666" }}>
              Statut : {m.statut} · {m.nbJours} jour(s) · démarrée le {new Date(m.createdAt).toLocaleDateString("fr-FR")}
            </p>
          </li>
        ))}
      </ul>

      <h1 style={{ marginTop: 32 }}>Vos documents</h1>
      {documents.length === 0 && <p style={{ color: "#888" }}>Aucun document disponible pour l'instant.</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {documents.map((d) => (
          <li key={d.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, display: "flex", justifyContent: "space-between" }}>
            <div>
              <p style={{ margin: 0, fontWeight: 600 }}>{d.titre}</p>
              <p style={{ margin: 0, fontSize: 13, color: "#666" }}>{d.type} · {new Date(d.createdAt).toLocaleDateString("fr-FR")}</p>
            </div>
            <a href={d.fileUrl} target="_blank" rel="noopener noreferrer">Télécharger</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Validation client des feuilles de temps (CRA) déjà validées par l'Admin —
// dernière étape avant facturation, façon BoondManager (voir
// app/api/feuilles-de-temps et /admin/feuilles-de-temps).
function FeuillesATraiter({ feuilles, recharger }: { feuilles: FeuilleClient[]; recharger: () => void }) {
  const [envoi, setEnvoi] = useState<string | null>(null);

  async function valider(id: string) {
    setEnvoi(id);
    await fetch("/api/feuilles-de-temps", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "validerClient" }),
    });
    setEnvoi(null);
    recharger();
  }

  if (feuilles.length === 0) return null;

  return (
    <div style={{ marginBottom: 32 }}>
      <h1>Feuilles de temps à valider ({feuilles.length})</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {feuilles.map((f) => (
          <div key={f.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
                {f.mission.profil.nom} — {f.mission.repere ?? libelleMois(f.mois)}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 13, color: "#666" }}>
                {libelleMois(f.mois)} · {f.joursTravailles} j
                {f.heuresSupplementaires > 0 ? ` · ${f.heuresSupplementaires} h sup` : ""}
              </p>
            </div>
            <button
              onClick={() => valider(f.id)}
              disabled={envoi === f.id}
              style={{ fontSize: 13, padding: "6px 14px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
            >
              {envoi === f.id ? "..." : "Valider"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Évaluation d'une mission terminée (1 à 5, façon avis client) — voir
// prisma/schema.prisma (Evaluation) et statistiques de l'ingénieur
// (EspaceIngenieur.tsx).
function EvaluationsAFaire({ missions, recharger }: { missions: MissionEvaluable[]; recharger: () => void }) {
  const aEvaluer = missions.filter((m) => !m.evaluation);
  if (aEvaluer.length === 0) return null;

  return (
    <div style={{ marginBottom: 32 }}>
      <h1>Évaluer une mission terminée</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {aEvaluer.map((m) => (
          <FormulaireEvaluation key={m.id} mission={m} recharger={recharger} />
        ))}
      </div>
    </div>
  );
}

function FormulaireEvaluation({ mission, recharger }: { mission: MissionEvaluable; recharger: () => void }) {
  const [note, setNote] = useState(0);
  const [commentaire, setCommentaire] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function envoyer() {
    if (note < 1) return;
    setEnvoi(true);
    await fetch("/api/evaluations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missionId: mission.id, note, commentaire }),
    });
    setEnvoi(false);
    recharger();
  }

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
      <p style={{ margin: "0 0 8px", fontWeight: 600, fontSize: 14 }}>{mission.repere ?? mission.profil.nom}</p>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => setNote(n)}
            style={{ fontSize: 18, background: "none", border: "none", cursor: "pointer", color: n <= note ? "#d97706" : "#ddd", padding: 0 }}
            aria-label={`${n} étoile(s)`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        placeholder="Commentaire (facultatif)"
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        rows={2}
        style={{ width: "100%", padding: 6, fontFamily: "inherit", marginBottom: 8 }}
      />
      <button
        onClick={envoyer}
        disabled={note < 1 || envoi}
        style={{ fontSize: 13, padding: "6px 14px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
      >
        {envoi ? "..." : "Envoyer l'évaluation"}
      </button>
    </div>
  );
}
