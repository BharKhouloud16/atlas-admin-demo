"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bleuFonce, bleu, grisTexte, bordure, vert } from "@/lib/theme";

// COMPANY ATLAS — DB-09 : Capability UI (08/10/2026).
//
// Consomme STRICTEMENT GET /api/capabilities (voir route.ts — seul ajout
// backend de ce lot, lecture seule, ADMIN-only, additif). Aucun champ
// affiché n'est inventé : chaque colonne est une projection directe d'un
// champ réellement persisté sur CapabilityRequirement (A8) — jamais un
// score, jamais un statut fabriqué. "Missions liées" est un simple compte
// de MissionCapabilityLink réels (A21), jamais un matching recalculé.

type CapabiliteLigne = {
  id: string;
  needTexte: string;
  clientNom: string;
  requiredCapability: string;
  rationale: string;
  provenance: string;
  status: string;
  createdAt: string;
  nombreMissionsLiees: number;
};

const COULEUR_STATUT: Record<string, string> = { ACTIVE: vert, SUPERSEDED: grisTexte };
const TOUS = "TOUS";
const STATUTS = ["ACTIVE", "SUPERSEDED"];

function Badge({ valeur }: { valeur: string }) {
  const couleur = COULEUR_STATUT[valeur] ?? grisTexte;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur }}>{valeur}</span>;
}

export default function CapabilitiesListePage() {
  const [capabilities, setCapabilities] = useState<CapabiliteLigne[]>([]);
  const [filtreStatut, setFiltreStatut] = useState(TOUS);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  function charger(statut: string) {
    setChargement(true);
    const url = statut === TOUS ? "/api/capabilities" : `/api/capabilities?statut=${encodeURIComponent(statut)}`;
    fetch(url)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error ?? `Erreur ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        setCapabilities(d.capabilities ?? []);
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
  if (erreur) return <p style={{ color: "#b91c1c" }}>{erreur}</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0, marginBottom: 4, color: bleuFonce }}>Capabilities</h1>
      <p style={{ fontSize: 13, color: grisTexte, marginBottom: 16, maxWidth: 760 }}>
        Capacités requises (CapabilityRequirement, A8) dérivées des besoins clients — projection fidèle du moteur
        existant, aucun recalcul ni score côté interface. Chaque ligne provient d&apos;un fait COMPETENCE déclaré sur un
        besoin ; les Missions qui la mobilisent réellement sont reliées via MissionCapabilityLink (A21).
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
              <th style={{ padding: "6px 8px" }}>Capacité requise</th>
              <th style={{ padding: "6px 8px" }}>Client</th>
              <th style={{ padding: "6px 8px" }}>Provenance</th>
              <th style={{ padding: "6px 8px" }}>Statut</th>
              <th style={{ padding: "6px 8px" }}>Missions liées</th>
              <th style={{ padding: "6px 8px" }}>Créée le</th>
              <th style={{ padding: "6px 8px" }}></th>
            </tr>
          </thead>
          <tbody>
            {capabilities.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 8px" }}>{c.requiredCapability}</td>
                <td style={{ padding: "6px 8px" }}>{c.clientNom}</td>
                <td style={{ padding: "6px 8px", fontSize: 12, color: grisTexte }}>{c.provenance}</td>
                <td style={{ padding: "6px 8px" }}><Badge valeur={c.status} /></td>
                <td style={{ padding: "6px 8px" }}>{c.nombreMissionsLiees}</td>
                <td style={{ padding: "6px 8px", fontSize: 12, color: grisTexte }}>{new Date(c.createdAt).toLocaleDateString("fr-FR")}</td>
                <td style={{ padding: "6px 8px" }}>
                  <Link href={`/admin/capabilities/${c.id}`} style={{ color: bleu, fontSize: 12 }}>Ouvrir →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {capabilities.length === 0 && (
          <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>
            Aucune capability{filtreStatut !== TOUS ? ` au statut ${filtreStatut}` : ""}.
          </p>
        )}
      </div>
    </div>
  );
}
