"use client";

import { useEffect, useMemo, useState } from "react";
import { convertirEnEur } from "@/lib/localisation";
import {
  calculerScore,
  calculerScoreDetail,
  calculerBadgeConfiance,
  suggestionPourProfil,
  type ComparaisonTjm,
} from "@/lib/scoring";
import { TOUTES_COMPETENCES } from "@/lib/competences";
import { bleu, bleuFonce } from "@/lib/theme";
import type { Realisation } from "@/app/api/ingenieur/realisations/route";

type Profil = {
  id: string;
  nom: string;
  prenom: string | null;
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
  cvImporteLe: string | null;
  questionnaireValide: boolean;
  competences: string[];
  entretiensRealises: number;
  realisations: Realisation[] | null;
  videoUrl: string | null;
  missionsTerminees: number;
  evaluationMoyenne: number | null;
  nombreEvaluations: number;
};

// Alerte simple : un CV importé mais pas encore validé depuis plus de 48h
// mérite d'être traité en priorité (même logique que /admin/comptes-en-attente).
const SEUIL_ALERTE_CV_HEURES = 48;
function heuresEnAttente(dateIso: string): number {
  return Math.floor((Date.now() - new Date(dateIso).getTime()) / (1000 * 60 * 60));
}
function cvEnAlerte(p: Profil): boolean {
  return !!p.cvUrl && !p.cvValide && !!p.cvImporteLe && heuresEnAttente(p.cvImporteLe) >= SEUIL_ALERTE_CV_HEURES;
}

type Ligne = {
  p: Profil;
  tjmSouhaiteEur: number | null;
  comparaison: ComparaisonTjm;
  score: number;
  suggestion: string;
};

const SENIORITES = ["Junior", "Confirmé", "Senior", "Expert"];

function nomComplet(p: Profil): string {
  return p.prenom ? `${p.prenom} ${p.nom}` : p.nom;
}

// Tableau de bord Admin pour le matching des profils ingénieurs : vue
// d'ensemble (KPI + graphiques) puis tableau détaillé avec, pour chaque
// profil, un score indicatif de "proposabilité" et une suggestion d'action
// (voir lib/scoring.ts). Permet aussi d'ouvrir directement le CV importé
// (voir /api/ingenieur/cv/fichier?profilId=...).
export default function ProfilsPage() {
  const [profils, setProfils] = useState<Profil[]>([]);
  const [chargement, setChargement] = useState(true);
  const [tri, setTri] = useState<"score" | "nom">("score");
  const [recherche, setRecherche] = useState("");
  const [filtreCompetence, setFiltreCompetence] = useState("");
  const [filtrePays, setFiltrePays] = useState("");
  const [nombreDesactives, setNombreDesactives] = useState(0);
  const [ouverts, setOuverts] = useState<Set<string>>(new Set());

  function basculerDetail(id: string) {
    setOuverts((prev) => {
      const suivant = new Set(prev);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  }

  useEffect(() => {
    fetch("/api/profils")
      .then((r) => r.json())
      .then((data) => {
        setProfils(Array.isArray(data.profils) ? data.profils : []);
        setNombreDesactives(typeof data.nombreDesactives === "number" ? data.nombreDesactives : 0);
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

  const paysDisponibles = useMemo(() => {
    const ensemble = new Set(profils.map((p) => (p.paysResidence === "Autre" ? p.paysResidencePrecision : p.paysResidence)).filter(Boolean) as string[]);
    return Array.from(ensemble).sort((a, b) => a.localeCompare(b));
  }, [profils]);

  const lignesFiltrees = useMemo(() => {
    const rechercheNorm = recherche.trim().toLowerCase();
    return lignes.filter((l) => {
      if (rechercheNorm && !nomComplet(l.p).toLowerCase().includes(rechercheNorm)) return false;
      if (filtreCompetence && !l.p.competences.includes(filtreCompetence)) return false;
      if (filtrePays) {
        const pays = l.p.paysResidence === "Autre" ? l.p.paysResidencePrecision : l.p.paysResidence;
        if (pays !== filtrePays) return false;
      }
      return true;
    });
  }, [lignes, recherche, filtreCompetence, filtrePays]);

  const lignesTriees = useMemo(() => {
    const copie = [...lignesFiltrees];
    if (tri === "score") copie.sort((a, b) => b.score - a.score);
    else copie.sort((a, b) => nomComplet(a.p).localeCompare(nomComplet(b.p)));
    return copie;
  }, [lignesFiltrees, tri]);

  function exporterCsv() {
    const entetes = [
      "Ingénieur",
      "Score",
      "Séniorité",
      "Pays de résidence",
      "Disponibilité",
      "TJM estimé (EUR)",
      "TJM souhaité",
      "EUR indicatif",
      "Comparaison",
      "Compétences",
      "Entretiens",
      "Suggestion",
    ];
    const echapper = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lignesCsv = lignesTriees.map((l) =>
      [
        nomComplet(l.p),
        String(l.score),
        l.p.seniorite ?? "",
        (l.p.paysResidence === "Autre" ? l.p.paysResidencePrecision : l.p.paysResidence) ?? "",
        l.p.disponibilite ?? "",
        l.p.tjmEstime != null ? String(Math.round(l.p.tjmEstime)) : "",
        l.p.tjmSouhaite != null ? `${l.p.tjmSouhaite} ${l.p.tjmSouhaiteDevise ?? ""}`.trim() : "",
        l.tjmSouhaiteEur != null ? String(l.tjmSouhaiteEur) : "",
        l.comparaison.label,
        l.p.competences.join(" ; "),
        String(l.p.entretiensRealises),
        l.suggestion,
      ]
        .map(echapper)
        .join(",")
    );
    const csv = [entetes.map(echapper).join(","), ...lignesCsv].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `profils-atlas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (chargement) {
    return <div>Chargement...</div>;
  }

  const total = profils.length;
  const cvValides = profils.filter((p) => p.cvValide).length;
  const disponiblesMaintenant = profils.filter((p) => p.disponibilite === "Disponible immédiatement").length;
  const scoreMoyen = total > 0 ? Math.round(lignes.reduce((s, l) => s + l.score, 0) / total) : 0;
  const alertesStatut = lignes.filter((l) => l.p.regimeSuggere?.includes("⚠")).length;
  const cvEnAttenteDepuisLongtemps = profils.filter(cvEnAlerte).length;

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
      <h1 style={{ marginBottom: 4, color: bleuFonce }}>Profils &amp; Matching</h1>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 20, maxWidth: 760 }}>
        Vue d&apos;ensemble des profils ingénieurs pour le matching client : score indicatif de proposabilité
        (séniorité, expérience, disponibilité, dossier complet, cohérence tarifaire) et suggestion d&apos;action pour
        chaque profil. TJM estimé = analyse interne du profil ; TJM souhaité = prétention déclarée par l&apos;ingénieur,
        convertie en euros à titre indicatif (taux fixes). Ces indicateurs sont une aide à la décision, pas une
        vérité absolue.
      </p>

      {nombreDesactives > 0 && (
        <p
          style={{
            fontSize: 12,
            color: "#92400e",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 8,
            padding: "8px 12px",
            marginBottom: 20,
            maxWidth: 760,
          }}
        >
          {nombreDesactives} profil{nombreDesactives > 1 ? "s" : ""} masqué{nombreDesactives > 1 ? "s" : ""} ici
          car l&apos;ingénieur a temporairement désactivé son compte — il{nombreDesactives > 1 ? "s" : ""}{" "}
          réapparaîtr{nombreDesactives > 1 ? "ont" : "a"} automatiquement dès réactivation.
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <Kpi label="Profils" valeur={String(total)} />
        <Kpi
          label="CV validés"
          valeur={`${cvValides} / ${total}`}
          note={cvEnAttenteDepuisLongtemps > 0 ? `${cvEnAttenteDepuisLongtemps} CV en attente depuis +48h` : undefined}
          noteCouleur="#d97706"
        />
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

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Rechercher un ingénieur..."
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          style={{ fontSize: 13, padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, minWidth: 200 }}
        />
        <select
          value={filtreCompetence}
          onChange={(e) => setFiltreCompetence(e.target.value)}
          style={{ fontSize: 13, padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}
        >
          <option value="">Toutes compétences</option>
          {TOUTES_COMPETENCES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={filtrePays}
          onChange={(e) => setFiltrePays(e.target.value)}
          style={{ fontSize: 13, padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}
        >
          <option value="">Tous pays</option>
          {paysDisponibles.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {(recherche || filtreCompetence || filtrePays) && (
          <button
            onClick={() => {
              setRecherche("");
              setFiltreCompetence("");
              setFiltrePays("");
            }}
            style={{ fontSize: 12, padding: "6px 10px" }}
          >
            Réinitialiser
          </button>
        )}
        <span style={{ fontSize: 12, color: "#888" }}>
          {lignesTriees.length} / {total} profil(s)
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={exporterCsv}
          style={{ fontSize: 12, padding: "6px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
          disabled={lignesTriees.length === 0}
        >
          Exporter CSV
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <p style={{ fontSize: 13, color: "#666", margin: 0 }}>Trier par :</p>
        <button
          onClick={() => setTri("score")}
          style={{ fontSize: 12, padding: "4px 10px", fontWeight: tri === "score" ? 700 : 400, color: tri === "score" ? bleu : undefined }}
        >
          Score
        </button>
        <button
          onClick={() => setTri("nom")}
          style={{ fontSize: 12, padding: "4px 10px", fontWeight: tri === "nom" ? 700 : 400, color: tri === "nom" ? bleu : undefined }}
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
              <th style={{ padding: "6px 8px" }}>Badge</th>
              <th style={{ padding: "6px 8px" }}>Séniorité</th>
              <th style={{ padding: "6px 8px" }}>Pays de résidence</th>
              <th style={{ padding: "6px 8px" }}>Disponibilité</th>
              <th style={{ padding: "6px 8px" }}>Compétences</th>
              <th style={{ padding: "6px 8px" }}>Entretiens</th>
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
              <LigneProfil
                key={l.p.id}
                l={l}
                ouvert={ouverts.has(l.p.id)}
                onToggleDetail={() => basculerDetail(l.p.id)}
                onEntretiensChange={(id, valeur) =>
                  setProfils((prev) => prev.map((p) => (p.id === id ? { ...p, entretiensRealises: valeur } : p)))
                }
              />
            ))}
          </tbody>
        </table>
        {profils.length === 0 && (
          <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Aucun profil pour l&apos;instant.</p>
        )}
        {profils.length > 0 && lignesTriees.length === 0 && (
          <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Aucun profil ne correspond à ces filtres.</p>
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
      <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: bleuFonce }}>{valeur}</p>
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

const NB_COLONNES = 14;

function LigneProfil({
  l,
  ouvert,
  onToggleDetail,
  onEntretiensChange,
}: {
  l: Ligne;
  ouvert: boolean;
  onToggleDetail: () => void;
  onEntretiensChange: (id: string, valeur: number) => void;
}) {
  const { p, tjmSouhaiteEur, comparaison, score, suggestion } = l;
  const scoreCouleur = score >= 75 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626";
  const alerteStatut = p.regimeSuggere?.includes("⚠");
  const badge = calculerBadgeConfiance({
    evaluationMoyenne: p.evaluationMoyenne,
    nombreEvaluations: p.nombreEvaluations,
    missionsTerminees: p.missionsTerminees,
  });

  return (
    <>
    <tr style={{ borderBottom: ouvert ? "none" : "1px solid #f0f0f0" }}>
      <td style={{ padding: "6px 8px" }}>
        <button
          onClick={onToggleDetail}
          style={{
            all: "unset",
            cursor: "pointer",
            fontWeight: 600,
            color: bleuFonce,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
          title="Voir le détail du score et le portfolio"
        >
          <span style={{ fontSize: 10, color: "#888", transform: ouvert ? "rotate(90deg)" : "none", display: "inline-block" }}>
            ▸
          </span>
          {nomComplet(p)}
        </button>
      </td>
      <td style={{ padding: "6px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 48, background: "#f0f0f0", borderRadius: 4, height: 8, overflow: "hidden" }}>
            <div style={{ width: `${score}%`, background: scoreCouleur, height: "100%" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: scoreCouleur }}>{score}</span>
        </div>
      </td>
      <td style={{ padding: "6px 8px" }}>
        {badge ? (
          <span
            title={badge.explication}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 999,
              color: badge.couleur,
              background: badge.couleur + "1a",
              whiteSpace: "nowrap",
            }}
          >
            {badge.niveau === "confirme" ? "★ " : ""}
            {badge.label}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: "#aaa" }}>-</span>
        )}
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
      <td style={{ padding: "6px 8px", maxWidth: 180 }}>
        {p.competences.length === 0 ? (
          <span style={{ color: "#aaa" }}>-</span>
        ) : (
          <span title={p.competences.join(", ")} style={{ display: "inline-flex", flexWrap: "wrap", gap: 3 }}>
            {p.competences.slice(0, 2).map((c) => (
              <span key={c} style={{ fontSize: 11, padding: "1px 6px", borderRadius: 999, background: "#f0f2f6", color: "#4b5567" }}>
                {c}
              </span>
            ))}
            {p.competences.length > 2 && (
              <span style={{ fontSize: 11, color: "#888" }}>+{p.competences.length - 2}</span>
            )}
          </span>
        )}
      </td>
      <td style={{ padding: "6px 8px" }}>
        <EntretiensCell profilId={p.id} valeur={p.entretiensRealises} onChange={onEntretiensChange} />
      </td>
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
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <a href={`/api/ingenieur/cv/fichier?profilId=${p.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
              Ouvrir
            </a>
            {cvEnAlerte(p) && (
              <span
                title={`CV importé le ${p.cvImporteLe ? new Date(p.cvImporteLe).toLocaleDateString("fr-FR") : "?"}, non encore validé`}
                style={{ fontSize: 11, fontWeight: 600, color: "#b45309", whiteSpace: "nowrap" }}
              >
                ⚠ +48h
              </span>
            )}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: "#aaa" }}>-</span>
        )}
      </td>
    </tr>
    {ouvert && (
      <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
        <td colSpan={NB_COLONNES} style={{ padding: "4px 8px 16px 32px", background: "#f9fafc" }}>
          <DetailProfil l={l} badge={badge} />
        </td>
      </tr>
    )}
    </>
  );
}

// Panneau de détail dépliable : explique le score (au lieu de livrer un
// chiffre opaque, façon Bullhorn "pourquoi ce match ?") et présente le
// portfolio de réalisations de l'ingénieur (façon Malt) — voir
// lib/scoring.ts et Profil.realisations.
function DetailProfil({ l, badge }: { l: Ligne; badge: ReturnType<typeof calculerBadgeConfiance> }) {
  const detail = calculerScoreDetail(l.p, l.comparaison);
  const realisations = l.p.realisations ?? [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, maxWidth: 900, padding: "8px 0" }}>
      <div>
        <p style={{ fontSize: 12, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
          Détail du score ({l.score}/100)
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {detail.map((c) => (
            <div key={c.cle} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "#4b5567", width: 150, flexShrink: 0 }} title={c.detail}>
                {c.label}
              </span>
              <div style={{ flex: 1, background: "#eef0f5", borderRadius: 4, height: 10, overflow: "hidden" }}>
                <div style={{ width: `${c.points}%`, background: bleu, height: "100%" }} />
              </div>
              <span style={{ fontSize: 11, color: "#888", width: 42, textAlign: "right" }}>{c.poidsPct}%</span>
              <span style={{ fontSize: 11, color: bleuFonce, width: 90, textAlign: "right" }}>{c.detail}</span>
            </div>
          ))}
        </div>
        {badge && (
          <p style={{ fontSize: 12, color: badge.couleur, marginTop: 10 }}>
            {badge.label} — {badge.explication}
          </p>
        )}
      </div>
      <div>
        <p style={{ fontSize: 12, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
          Réalisations ({realisations.length})
        </p>
        {realisations.length === 0 ? (
          <p style={{ fontSize: 12, color: "#aaa" }}>Aucune réalisation renseignée par l&apos;ingénieur pour l&apos;instant.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
            {realisations.map((r) => (
              <div key={r.id} style={{ border: "1px solid #e4e7ee", borderRadius: 6, padding: 8, background: "#fff" }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: bleuFonce }}>{r.titre}</p>
                {r.description && <p style={{ margin: "3px 0 0", fontSize: 11, color: "#4b5567" }}>{r.description}</p>}
                {r.lien && (
                  <a href={r.lien} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>
                    {r.lien}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
        {l.p.videoUrl && (
          <div style={{ marginTop: 14 }}>
            <p style={{ fontSize: 12, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
              Vidéo de présentation
            </p>
            <video
              src={`/api/ingenieur/video/fichier?profilId=${l.p.id}`}
              controls
              style={{ maxWidth: 280, borderRadius: 8, border: "1px solid #e4e7ee" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Nombre d'entretiens réalisés par l'ingénieur — pas de module d'entretiens
// dédié pour l'instant, donc saisi manuellement par l'Admin ici même,
// enregistré au blur (voir PATCH /api/profils). Affiché à l'ingénieur dans
// ses statistiques personnelles (voir EspaceIngenieur.tsx).
function EntretiensCell({
  profilId,
  valeur,
  onChange,
}: {
  profilId: string;
  valeur: number;
  onChange: (id: string, valeur: number) => void;
}) {
  const [local, setLocal] = useState(String(valeur));
  const [envoi, setEnvoi] = useState(false);

  async function enregistrer() {
    const n = Math.max(0, Math.round(Number(local) || 0));
    setLocal(String(n));
    if (n === valeur) return;
    setEnvoi(true);
    await fetch("/api/profils", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: profilId, entretiensRealises: n }),
    });
    setEnvoi(false);
    onChange(profilId, n);
  }

  return (
    <input
      type="number"
      min={0}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={enregistrer}
      disabled={envoi}
      style={{ width: 48, padding: "3px 6px", fontSize: 12, border: "1px solid #e4e7ee", borderRadius: 4 }}
    />
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
