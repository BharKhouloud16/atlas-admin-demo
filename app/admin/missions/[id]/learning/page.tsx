"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { bleuFonce, bleu, grisTexte, bordure, rouge } from "@/lib/theme";

// COMPANY ATLAS — DB-04 : Learning UI (08/10/2026).
//
// Consomme STRICTEMENT GET /api/missions/[id]/learning (A30, inchangée) —
// ADMIN et INGENIEUR autorisé (contrat A30 §18, même fonction
// estIngenieurAutoriseSurMission que A26/A27/A29) ; CLIENT et Agent
// n'ont aucun accès, confirmé par la route elle-même. Cette page ne fait
// qu'afficher — aucune mutation, aucun calcul, aucune logique de
// validation/obsolescence ici (voir la page détail).
//
// Filtres purement côté client sur la liste déjà chargée (contrat DB-04
// §21 : "pas de moteur de recherche générique, pas d'embeddings") —
// jamais une nouvelle requête serveur, jamais un paramètre d'URL inventé.

type Learning = {
  id: string;
  title: string;
  type: string;
  provenance: string;
  confidence: string;
  scope: string;
  statut: string;
  applicabilite: string;
  createdAt: string;
};

const COULEUR_STATUT: Record<string, string> = { PROPOSE: "#d97706", VALIDE: "#1a7f4b" };
const COULEUR_APPLICABILITE: Record<string, string> = { ACTIVE: "#1a7f4b", OBSOLETE: "#888" };
const COULEUR_CONFIDENCE: Record<string, string> = { LOW: grisTexte, MEDIUM: "#d97706", HIGH: bleu };

function Badge({ valeur, couleurs }: { valeur: string; couleurs: Record<string, string> }) {
  const couleur = couleurs[valeur] ?? grisTexte;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur }}>{valeur}</span>;
}

const TOUS = "TOUS";

export default function LearningListePage() {
  const params = useParams<{ id: string }>();
  const missionId = params.id;

  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [filtreStatut, setFiltreStatut] = useState(TOUS);
  const [filtreType, setFiltreType] = useState(TOUS);
  const [filtreProvenance, setFiltreProvenance] = useState(TOUS);
  const [filtreConfidence, setFiltreConfidence] = useState(TOUS);
  const [filtreScope, setFiltreScope] = useState(TOUS);

  useEffect(() => {
    fetch(`/api/missions/${missionId}/learning`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error ?? `Erreur ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        setLearnings(d.learnings ?? []);
        setErreur(null);
      })
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }, [missionId]);

  if (chargement) return <p style={{ color: "#888" }}>Chargement…</p>;
  if (erreur) return <p style={{ color: rouge }}>{erreur}</p>;

  function optionsDe(champ: keyof Learning): string[] {
    return [...new Set(learnings.map((l) => l[champ] as string))].sort();
  }

  const filtres = learnings.filter(
    (l) =>
      (filtreStatut === TOUS || l.statut === filtreStatut) &&
      (filtreType === TOUS || l.type === filtreType) &&
      (filtreProvenance === TOUS || l.provenance === filtreProvenance) &&
      (filtreConfidence === TOUS || l.confidence === filtreConfidence) &&
      (filtreScope === TOUS || l.scope === filtreScope)
  );

  function SelectFiltre({ label, valeur, onChange, champ }: { label: string; valeur: string; onChange: (v: string) => void; champ: keyof Learning }) {
    return (
      <label style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 2 }}>
        {label}
        <select value={valeur} onChange={(e) => onChange(e.target.value)} style={{ padding: 4 }}>
          <option value={TOUS}>Tous</option>
          {optionsDe(champ).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }

  return (
    <div>
      <Link href="/admin/missions" style={{ color: bleu, fontSize: 13 }}>← Toutes les missions</Link>
      <h1 style={{ marginTop: 8, marginBottom: 4, color: bleuFonce }}>Learnings de la mission</h1>
      <p style={{ fontSize: 13, color: grisTexte, marginBottom: 20 }}>
        Connaissance proposée à partir de l&apos;expérience de cette mission — jamais une vérité automatique : seule une
        validation Admin explicite distingue une proposition d&apos;un Learning validé.
      </p>

      {learnings.length > 0 && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16, padding: 10, border: `1px solid ${bordure}` }}>
          <SelectFiltre label="Statut" valeur={filtreStatut} onChange={setFiltreStatut} champ="statut" />
          <SelectFiltre label="Type" valeur={filtreType} onChange={setFiltreType} champ="type" />
          <SelectFiltre label="Provenance" valeur={filtreProvenance} onChange={setFiltreProvenance} champ="provenance" />
          <SelectFiltre label="Confidence" valeur={filtreConfidence} onChange={setFiltreConfidence} champ="confidence" />
          <SelectFiltre label="Scope" valeur={filtreScope} onChange={setFiltreScope} champ="scope" />
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
              <th style={{ padding: "6px 8px" }}>Titre</th>
              <th style={{ padding: "6px 8px" }}>Type</th>
              <th style={{ padding: "6px 8px" }}>Provenance</th>
              <th style={{ padding: "6px 8px" }}>Confidence</th>
              <th style={{ padding: "6px 8px" }}>Scope</th>
              <th style={{ padding: "6px 8px" }}>Statut</th>
              <th style={{ padding: "6px 8px" }}>Applicabilité</th>
              <th style={{ padding: "6px 8px" }}>Date</th>
              <th style={{ padding: "6px 8px" }}></th>
            </tr>
          </thead>
          <tbody>
            {filtres.map((l) => (
              <tr key={l.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 8px" }}>{l.title}</td>
                <td style={{ padding: "6px 8px" }}>{l.type}</td>
                <td style={{ padding: "6px 8px" }}>{l.provenance}</td>
                <td style={{ padding: "6px 8px" }}><Badge valeur={l.confidence} couleurs={COULEUR_CONFIDENCE} /></td>
                <td style={{ padding: "6px 8px" }}>{l.scope}</td>
                <td style={{ padding: "6px 8px" }}><Badge valeur={l.statut} couleurs={COULEUR_STATUT} /></td>
                <td style={{ padding: "6px 8px" }}><Badge valeur={l.applicabilite} couleurs={COULEUR_APPLICABILITE} /></td>
                <td style={{ padding: "6px 8px", fontSize: 12, color: grisTexte }}>{new Date(l.createdAt).toLocaleDateString("fr-FR")}</td>
                <td style={{ padding: "6px 8px" }}>
                  <Link href={`/admin/missions/${missionId}/learning/${l.id}`} style={{ color: bleu, fontSize: 12 }}>Ouvrir →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {learnings.length === 0 && <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Aucun Learning pour cette mission.</p>}
        {learnings.length > 0 && filtres.length === 0 && <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Aucun résultat pour ces filtres.</p>}
      </div>
    </div>
  );
}
