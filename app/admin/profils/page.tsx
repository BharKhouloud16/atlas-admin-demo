"use client";

import { useEffect, useMemo, useState } from "react";
import { convertirEnEur } from "@/lib/localisation";
import { calculerScore, suggestionPourProfil, type ComparaisonTjm } from "@/lib/scoring";

type Profil = {
  id: string;
  nom: string;
  seniorite: string | null;
  anneesExperience: number | null;
  tjmEstime: number | null;
  disponibilite: string | null;
  nationalite: string | null;
  nationalitePrecision: string | null;
  paysResidence: string | null;
  paysResidencePrecision: string | null;
  regimeSuggere: string | null;
  tjmSouhaite: number | null;
  tjmSouhaiteDevise: string | null;
  cvUrl: string | null;
  cvValide: boolean;
  questionnaireValide: boolean;
};

type Ligne = {
  p: Profil;
  tjmSouhaiteEur: number | null;
  comparaison: ComparaisonTjm;
  score: number;
  suggestion: string;
};

const SENIORITES = ["Junior", "Confirmé", "Senior", "Expert"];

// Tableau de bord Admin pour le matching des profils ingénieurs : vue
// d'ensemble (KPI + graphiques) puis tableau détaillé avec, pour chaque
// profil, un score indicatif de "proposabilité" et une suggestion d'action
// (voir lib/scoring.ts). Permet aussi d'ouvrir directement le CV importé
// (voir /api/ingenieur/cv/fichier?profilId=...).
export default function ProfilsPage() {
  const [profils, setProfils] = useState<Profil[]>([]);
  const [chargement, setChargement] = useState(true);
  const [tri, setTri] = useState<"score" | "nom">("score");

  useEffect(() => {
    fetch("/api/profils")
      .then((r) => r.json())
      .then((data) => {
        setProfils(Array.isArray(data) ? data : []);
        setChargement(false);
      });
  }, []);

  const lignes: Ligne[] = useMemo(() => {
    return profils.map((p) => {
      const tjmSouhaiteEur =
        p.tjmSouhaite != null && p.tjmSouhaiteDevise ? convertirEnEur(p.tjmSouhaite, p.tjmSouhaiteDevise) : null;
      const comparaison = comparerTjm(p.tjmEstime, tjmSouhaiteEur);
      const score = calculerScore(p, comparaison);
      const suggestion = suggestionPourProfil(p, comparaison, score);
      return { p, tjmSouhaiteEur, comparaison, score, suggestion };
    });
  }, [profils]);

  const lignesTriees = useMemo(() => {
    const copie = [...lignes];
    if (tri === "score") copie.sort((a, b) => b.score - a.score);
    else copie.sort((a, b) => a.p.nom.localeCompare(b.p.nom));
    return copie;
  }, [lignes, tri]);

  if (chargement) {
    return <div>Chargement...</div>;
  }

  const total = profils.length;
  const cvValides = profils.filter((p) => p.cvValide).length;
  const disponiblesMaintenant = profils.filter((p) => p.disponibilite === "Disponible immédiatement").length;
  const scoreMoyen = total > 0 ? Math.round(lignes.reduce((s, l) => s + l.score, 0) / total) : 0;
  const alertesStatut = lignes.filter((l) => l.p.regimeSuggere?.includes("⚠")).length;

  const repartitionSeniorite = SENIORITES.map((s) => ({
    label: s,
    valeur: profils.filter((p) => p.seniorite === s).length,
  }));
  const statutsDispo = [
    "Disponible immédiatement",
    "En mission actuellement chez Atlas",
    "En mission actuellement chez un autre client",
    "Non disponible immédiatement",
  ];
  const repartitionDispo = statutsDispo.map((s) => ({
    label: s,
    valeur: profils.filter((p) => p.disponibilite === s).length,
  }));

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Profils &amp; Matching</h1>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 20, maxWidth: 760 }}>
        Vue d&apos;ensemble des profils ingénieurs pour le matching client : score indicatif de proposabilité
        (séniorité, expérience, disponibilité, dossier complet, cohérence tarifaire) et suggestion d&apos;action pour
        chaque profil. TJM estimé = analyse interne du profil ; TJM souhaité = prétention déclarée par l&apos;ingénieur,
        convertie en euros à titre indicatif (taux fixes). Ces indicateurs sont une aide à la décision, pas une
        vérité absolue.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <Kpi label="Profils" valeur={String(total)} />
        <Kpi label="CV validés" valeur={`${cvValides} / ${total}`} />
        <Kpi label="Disponibles immédiatement" valeur={String(disponiblesMaintenant)} />
        <Kpi
          label="Score moyen"
          valeur={String(scoreMoyen)}
          note={alertesStatut > 0 ? `${alertesStatut} statut(s) à clarifier` : undefined}
          noteCouleur="#d97706"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
        <GraphiqueBarres titre="Répartition par séniorité" donnees={repartitionSeniorite} total={total} couleur="#2563eb" />
        <GraphiqueBarres titre="Répartition par disponibilité" donnees={repartitionDispo} total={total} couleur="#16a34a" />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <p style={{ fontSize: 13, color: "#666", margin: 0 }}>Trier par :</p>
        <button
          onClick={() => setTri("score")}
          style={{ fontSize: 12, padding: "4px 10px", fontWeight: tri === "score" ? 700 : 400 }}
        >
          Score
        </button>
        <button
          onClick={() => setTri("nom")}
          style={{ fontSize: 12, padding: "4px 10px", fontWeight: tri === "nom" ? 700 : 400 }}
        >
          Nom
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "6px 8px" }}>Ingénieur</th>
              <th style={{ padding: "6px 8px" }}>Score</th>
              <th style={{ padding: "6px 8px" }}>Séniorité</th>
              <th style={{ padding: "6px 8px" }}>Pays de résidence</th>
              <th style={{ padding: "6px 8px" }}>Disponibilité</th>
              <th style={{ padding: "6px 8px" }}>TJM estimé</th>
              <th style={{ padding: "6px 8px" }}>TJM souhaité</th>
              <th style={{ padding: "6px 8px" }}>EUR (indicatif)</th>
              <th style={{ padding: "6px 8px" }}>Comparaison</th>
              <th style={{ padding: "6px 8px" }}>Suggestion</th>
              <th style={{ padding: "6px 8px" }}>CV</th>
            </tr>
          </thead>
          <tbody>
            {lignesTriees.map((l) => (
              <LigneProfil key={l.p.id} l={l} />
            ))}
          </tbody>
        </table>
        {profils.length === 0 && (
          <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Aucun profil pour l&apos;instant.</p>
        )}
      </div>
    </div>
  );
}

function Kpi({
  label,
  valeur,
  note,
  noteCouleur,
}: {
  label: string;
  valeur: string;
  note?: string;
  noteCouleur?: string;
}) {
  return (
    <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 14 }}>
      <p style={{ fontSize: 12, color: "#888", margin: "0 0 6px" }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{valeur}</p>
      {note && (
        <p style={{ fontSize: 11, color: noteCouleur ?? "#888", margin: "4px 0 0" }}>{note}</p>
      )}
    </div>
  );
}

function GraphiqueBarres({
  titre,
  donnees,
  total,
  couleur,
}: {
  titre: string;
  donnees: { label: string; valeur: number }[];
  total: number;
  couleur: string;
}) {
  const max = Math.max(1, ...donnees.map((d) => d.valeur));
  return (
    <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 14 }}>
      <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 12px" }}>{titre}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {donnees.map((d) => (
          <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#4b5567", width: 190, flexShrink: 0 }}>{d.label}</span>
            <div style={{ flex: 1, background: "#f0f0f0", borderRadius: 4, height: 14, overflow: "hidden" }}>
              <div
                style={{
                  width: `${(d.valeur / max) * 100}%`,
                  background: couleur,
                  height: "100%",
                  borderRadius: 4,
                  transition: "width 0.3s",
                }}
              />
            </div>
            <span style={{ fontSize: 12, color: "#888", width: 60, textAlign: "right" }}>
              {d.valeur} {total > 0 ? `(${Math.round((d.valeur / total) * 100)}%)` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LigneProfil({ l }: { l: Ligne }) {
  const { p, tjmSouhaiteEur, comparaison, score, suggestion } = l;
  const scoreCouleur = score >= 75 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626";
  const alerteStatut = p.regimeSuggere?.includes("⚠");

  return (
    <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
      <td style={{ padding: "6px 8px" }}>{p.nom}</td>
      <td style={{ padding: "6px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 48, background: "#f0f0f0", borderRadius: 4, height: 8, overflow: "hidden" }}>
            <div style={{ width: `${score}%`, background: scoreCouleur, height: "100%" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: scoreCouleur }}>{score}</span>
        </div>
      </td>
      <td style={{ padding: "6px 8px" }}>{p.seniorite ?? "-"}</td>
      <td style={{ padding: "6px 8px" }}>
        {p.paysResidence === "Autre" ? p.paysResidencePrecision ?? "-" : p.paysResidence ?? "-"}
        {alerteStatut && (
          <span title={p.regimeSuggere ?? ""} style={{ marginLeft: 6, fontSize: 12, color: "#d97706" }}>
            ⚠️
          </span>
        )}
      </td>
      <td style={{ padding: "6px 8px" }}>{p.disponibilite ?? "-"}</td>
      <td style={{ padding: "6px 8px" }}>{p.tjmEstime != null ? Math.round(p.tjmEstime) + " EUR" : "-"}</td>
      <td style={{ padding: "6px 8px" }}>
        {p.tjmSouhaite != null ? `${p.tjmSouhaite} ${p.tjmSouhaiteDevise ?? ""}`.trim() : "-"}
      </td>
      <td style={{ padding: "6px 8px" }}>{tjmSouhaiteEur != null ? "~ " + tjmSouhaiteEur + " EUR" : "-"}</td>
      <td style={{ padding: "6px 8px" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: comparaison.couleur }}>{comparaison.label}</span>
      </td>
      <td style={{ padding: "6px 8px", fontSize: 12, color: "#4b5567", maxWidth: 280 }}>{suggestion}</td>
      <td style={{ padding: "6px 8px" }}>
        {p.cvUrl ? (
          <a href={`/api/ingenieur/cv/fichier?profilId=${p.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
            Ouvrir
          </a>
        ) : (
          <span style={{ fontSize: 12, color: "#aaa" }}>-</span>
        )}
      </td>
    </tr>
  );
}

function comparerTjm(tjmEstime: number | null, tjmSouhaiteEur: number | null): ComparaisonTjm {
  if (tjmEstime == null || tjmSouhaiteEur == null) {
    return { label: "Analyse non disponible", couleur: "#9aa0ab" };
  }
  const ratio = tjmSouhaiteEur / tjmEstime;
  if (ratio <= 1.15) return { label: "Cohérent", couleur: "#16a34a" };
  if (ratio <= 1.4) return { label: "À négocier", couleur: "#d97706" };
  return { label: "Écart important", couleur: "#dc2626" };
}
