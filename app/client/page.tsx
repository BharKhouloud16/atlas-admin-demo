"use client";

import { useEffect, useState } from "react";
import { bleu } from "@/lib/theme";
import { libelleMois, type StatutCra } from "@/lib/feuilles-de-temps";
import type { Realisation } from "@/app/api/ingenieur/realisations/route";
import type { BadgeConfiance } from "@/lib/scoring";

type ProfilVitrine = {
  id: string;
  nom: string;
  prenom: string | null;
  realisations: Realisation[] | null;
  badge: BadgeConfiance;
  aVideo: boolean;
};

type Mission = {
  id: string;
  repere: string | null;
  statut: string;
  nbJours: number;
  createdAt: string;
  profil: ProfilVitrine;
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
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());

  function basculer(id: string) {
    setOuvertes((prev) => {
      const suivant = new Set(prev);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  }

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
        {missions.map((m) => {
          const ouverte = ouvertes.has(m.id);
          const aVitrine = (m.profil.realisations?.length ?? 0) > 0 || m.profil.badge || m.profil.aVideo;
          return (
            <li key={m.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>{m.repere ?? m.profil.nom}</p>
                  <p style={{ margin: 0, fontSize: 13, color: "#666" }}>
                    Statut : {m.statut} · {m.nbJours} jour(s) · démarrée le {new Date(m.createdAt).toLocaleDateString("fr-FR")}
                  </p>
                  {m.profil.badge && (
                    <span
                      title={m.profil.badge.explication}
                      style={{ display: "inline-block", marginTop: 6, fontSize: 11, padding: "2px 8px", borderRadius: 999, border: `1px solid ${m.profil.badge.couleur}`, color: m.profil.badge.couleur }}
                    >
                      {m.profil.badge.niveau === "confirme" ? "★ " : ""}
                      {m.profil.badge.label}
                    </span>
                  )}
                </div>
                {aVitrine && (
                  <button
                    onClick={() => basculer(m.id)}
                    style={{ fontSize: 12, padding: "5px 10px", background: "none", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer" }}
                  >
                    {ouverte ? "Masquer le profil" : "Voir le profil"}
                  </button>
                )}
              </div>
              {ouverte && <ProfilVitrineDetail profil={m.profil} />}
            </li>
          );
        })}
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

// Aperçu "vitrine" du profil de l'ingénieur, côté client : portfolio de
// réalisations et vidéo de présentation, en lecture seule — jamais de score
// de matching ni de TJM (réservés à l'Admin, voir /api/client/missions).
function ProfilVitrineDetail({ profil }: { profil: ProfilVitrine }) {
  const realisations = profil.realisations ?? [];

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #eee", display: "flex", flexDirection: "column", gap: 12 }}>
      {profil.aVideo && (
        <div>
          <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 6px" }}>
            Vidéo de présentation
          </p>
          <video
            src={`/api/ingenieur/video/fichier?profilId=${profil.id}`}
            controls
            style={{ maxWidth: 320, borderRadius: 8, border: "1px solid #eee" }}
          />
        </div>
      )}
      <div>
        <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 6px" }}>
          Réalisations
        </p>
        {realisations.length === 0 ? (
          <p style={{ fontSize: 12, color: "#aaa", margin: 0 }}>Aucune réalisation renseignée pour l&apos;instant.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {realisations.map((r) => (
              <div key={r.id} style={{ border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{r.titre}</p>
                {r.description && <p style={{ margin: "3px 0 0", fontSize: 12, color: "#666" }}>{r.description}</p>}
                {r.lien && (
                  <a href={r.lien} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                    {r.lien}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
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
