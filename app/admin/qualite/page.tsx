"use client";

import { useEffect, useState } from "react";
import { bleuFonce, grisTexte, bordure, fondClair } from "@/lib/theme";

// ATLAS OS — QUALITY FOUNDATION V1 (Batch 12.9, Intégration). Première
// page Admin du Signal Engine — lecture seule, consomme GET /api/quality
// (Batch 12.7/12.8) TEL QUEL, sans recalcul ni interprétation côté client.
//
// RÈGLES ABSOLUES (héritées de Batch 12.1-12.8, reconduites ici) :
// - ZÉRO score affiché, zéro barre de progression globale, zéro pourcentage
//   de synthèse : chaque Gate reste affiché INDIVIDUELLEMENT avec son
//   propre statut (vocabulaire fermé QualityStatus) et sa preuve — jamais
//   combinés en un seul indicateur "santé globale".
// - Les couleurs de badge ci-dessous ne font QUE visualiser le vocabulaire
//   déjà fermé (PASS/FAIL/WARNING/UNKNOWN/...) — elles n'ajoutent aucune
//   information, aucun niveau, aucune graduation qui n'existerait pas déjà
//   dans la donnée reçue de l'API.
// - UNKNOWN reste affiché comme UNKNOWN (gris, "non évaluable") — jamais
//   masqué, jamais requalifié en succès ou échec implicite.
// - Aucune écriture : cette page ne fait qu'un seul GET, jamais de POST/PUT.

type QualityStatus =
  | "UNKNOWN" | "NOT_EVALUATED" | "OBSERVED" | "PASS" | "WARNING" | "FAIL" | "BLOCKED" | "NOT_APPLICABLE";

type Gate = {
  gateId: string;
  label: string;
  statut: QualityStatus;
  preuve: string;
  signauxDeclencheurs: unknown[];
};

type Signal = {
  type: string;
  dimension: string;
  statut: QualityStatus;
  label: string;
  preuve: string;
};

type DimensionSnapshot = {
  dimension: string;
  observations: unknown[];
  signaux: unknown[];
  observationsParStatut: Record<QualityStatus, unknown[]>;
};

type CasRegression = {
  dimension: string;
  label: string;
  statutRecent: QualityStatus;
  ecartTemporelMs: number;
};

type ReponseQualite = {
  source: { owner: string; repo: string; observationsRejetees: number };
  observations: unknown[];
  signaux: Signal[];
  dimensions: Record<string, DimensionSnapshot>;
  gates: Gate[];
  regressions: CasRegression[];
};

const COULEUR_STATUT: Record<QualityStatus, { fond: string; texte: string }> = {
  PASS: { fond: "#e6f4ea", texte: "#1e7a34" },
  FAIL: { fond: "#fbe9e7", texte: "#b3261e" },
  WARNING: { fond: "#fff4e0", texte: "#8a5a00" },
  UNKNOWN: { fond: "#eef0f4", texte: "#5a6270" },
  NOT_EVALUATED: { fond: "#eef0f4", texte: "#5a6270" },
  BLOCKED: { fond: "#eef0f4", texte: "#5a6270" },
  OBSERVED: { fond: "#e8f0fe", texte: "#1a4b8c" },
  NOT_APPLICABLE: { fond: "#f3f3f3", texte: "#888" },
};

function BadgeStatut({ statut }: { statut: QualityStatus }) {
  const c = COULEUR_STATUT[statut] ?? COULEUR_STATUT.UNKNOWN;
  return (
    <span
      style={{
        display: "inline-block",
        background: c.fond,
        color: c.texte,
        fontSize: 12,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 999,
      }}
    >
      {statut}
    </span>
  );
}

export default function QualitePage() {
  const [donnees, setDonnees] = useState<ReponseQualite | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/quality")
      .then((r) => {
        if (!r.ok) throw new Error(`Réponse ${r.status}`);
        return r.json();
      })
      .then((d) => setDonnees(d))
      .catch(() => setErreur("Impossible de charger l'état qualité pour le moment."))
      .finally(() => setChargement(false));
  }, []);

  return (
    <div>
      <h1>Qualité ATLAS OS</h1>
      <p style={{ color: grisTexte, fontSize: 13, marginBottom: 4 }}>
        Signal Engine V1 — dérivé uniquement des runs CI réellement observés sur GitHub Actions. Chaque ligne reste
        indépendante et traçable jusqu&apos;à son observation d&apos;origine : il n&apos;existe volontairement aucun
        score global ni verdict de synthèse sur cette page.
      </p>

      {chargement && <p style={{ color: grisTexte }}>Chargement...</p>}
      {erreur && <p style={{ color: "#b3261e" }}>{erreur}</p>}

      {donnees && (
        <>
          <p style={{ color: grisTexte, fontSize: 12, marginBottom: 20 }}>
            Source : {donnees.source.owner}/{donnees.source.repo}
            {donnees.source.observationsRejetees > 0 && (
              <> — {donnees.source.observationsRejetees} observation(s) rejetée(s) (données non exploitables)</>
            )}
          </p>

          <section style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 16, color: bleuFonce }}>Gates ({donnees.gates.length})</h2>
            <p style={{ color: grisTexte, fontSize: 12, marginBottom: 12 }}>
              Chaque Gate est une règle nommée et indépendante — jamais combinée avec les autres.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {donnees.gates.map((g) => (
                <div key={g.gateId} style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{g.label}</p>
                    <BadgeStatut statut={g.statut} />
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: grisTexte }}>{g.preuve}</p>
                  {g.signauxDeclencheurs.length > 0 && (
                    <p style={{ margin: "4px 0 0", fontSize: 12, color: "#aaa" }}>
                      {g.signauxDeclencheurs.length} signal(aux) déclencheur(s)
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 16, color: bleuFonce }}>Dimensions</h2>
            <p style={{ color: grisTexte, fontSize: 12, marginBottom: 12 }}>
              Répartition des observations par statut, par dimension — un simple comptage, jamais un verdict par
              dimension.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
              {Object.values(donnees.dimensions).map((d) => (
                <div key={d.dimension} style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 12, background: fondClair }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{d.dimension}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: grisTexte }}>
                    {d.observations.length} observation(s), {d.signaux.length} signal(aux)
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 style={{ fontSize: 16, color: bleuFonce }}>Régressions possibles ({donnees.regressions.length})</h2>
            <p style={{ color: grisTexte, fontSize: 12, marginBottom: 12 }}>
              Hypothèses à examiner (un PASS antérieur suivi d&apos;un statut dégradé) — jamais présentées comme
              confirmées.
            </p>
            {donnees.regressions.length === 0 && (
              <p style={{ color: grisTexte, fontSize: 13 }}>Aucune régression possible détectée sur les observations disponibles.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {donnees.regressions.map((r, i) => (
                <div key={i} style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>
                      {r.dimension} — {r.label}
                    </p>
                    <BadgeStatut statut={r.statutRecent} />
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#aaa" }}>
                    Écart temporel : {Math.round(r.ecartTemporelMs / (1000 * 60 * 60))} h
                  </p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
