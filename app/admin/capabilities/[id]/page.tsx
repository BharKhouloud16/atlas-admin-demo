"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { bleuFonce, bleu, grisTexte, bordure, vert } from "@/lib/theme";

// COMPANY ATLAS — DB-09 : Capability UI (08/10/2026).
//
// Consomme STRICTEMENT GET /api/capabilities/[id] (seul ajout backend de
// ce lot avec route.ts du dossier parent). "Aucune Mission associée"
// (mandat DB-09 §6) rendu explicitement quand missionLinks est vide —
// jamais une absence silencieuse, jamais une déduction supplémentaire.

type MissionLien = {
  id: string;
  missionId: string;
  missionRepere: string | null;
  missionStatut: string;
  capability: string;
  rationale: string | null;
  statut: string;
  createdAt: string;
  createdByEmail: string;
};

type CapabiliteDetail = {
  id: string;
  needVersionId: string;
  needTexte: string;
  clientNom: string;
  solutionDecisionId: string | null;
  sourceFaitId: string;
  requiredCapability: string;
  rationale: string;
  provenance: string;
  status: string;
  createdAt: string;
  missionLinks: MissionLien[];
};

const COULEUR_STATUT: Record<string, string> = { ACTIVE: vert, SUPERSEDED: grisTexte };

function Badge({ valeur }: { valeur: string }) {
  const couleur = COULEUR_STATUT[valeur] ?? grisTexte;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur }}>{valeur}</span>;
}

export default function CapabiliteDetailPage() {
  const params = useParams<{ id: string }>();
  const capabilityId = params.id;

  const [capability, setCapability] = useState<CapabiliteDetail | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/capabilities/${capabilityId}`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error ?? `Erreur ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        setCapability(d);
        setErreur(null);
      })
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }, [capabilityId]);

  if (chargement) return <p style={{ color: "#888" }}>Chargement…</p>;
  if (erreur) return <p style={{ color: "#b91c1c" }}>{erreur}</p>;
  if (!capability) return null;

  return (
    <div>
      <p style={{ marginBottom: 12 }}>
        <Link href="/admin/capabilities" style={{ color: bleu, fontSize: 13 }}>← Capabilities</Link>
      </p>

      <h1 style={{ marginTop: 0, marginBottom: 4, color: bleuFonce }}>{capability.requiredCapability}</h1>
      <div style={{ marginBottom: 16 }}>
        <Badge valeur={capability.status} />
      </div>

      <div style={{ border: `1px solid ${bordure}`, padding: 14, marginBottom: 20, maxWidth: 760 }}>
        <p style={{ margin: "0 0 8px", fontSize: 13 }}><strong>Client :</strong> {capability.clientNom}</p>
        <p style={{ margin: "0 0 8px", fontSize: 13 }}><strong>Besoin d&apos;origine :</strong> {capability.needTexte}</p>
        <p style={{ margin: "0 0 8px", fontSize: 13 }}><strong>Justification :</strong> {capability.rationale}</p>
        <p style={{ margin: "0 0 8px", fontSize: 13 }}><strong>Provenance :</strong> {capability.provenance}</p>
        <p style={{ margin: 0, fontSize: 12, color: grisTexte }}>Créée le {new Date(capability.createdAt).toLocaleString("fr-FR")}</p>
      </div>

      <h2 style={{ fontSize: 16, color: bleuFonce, marginBottom: 10 }}>Missions associées</h2>
      {capability.missionLinks.length === 0 ? (
        <p style={{ fontSize: 13, color: "#888" }}>Aucune Mission associée</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, maxWidth: 900 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
                <th style={{ padding: "6px 8px" }}>Mission</th>
                <th style={{ padding: "6px 8px" }}>Statut Mission</th>
                <th style={{ padding: "6px 8px" }}>Statut du lien</th>
                <th style={{ padding: "6px 8px" }}>Justification de mobilisation</th>
                <th style={{ padding: "6px 8px" }}>Lié le</th>
              </tr>
            </thead>
            <tbody>
              {capability.missionLinks.map((l) => (
                <tr key={l.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 8px" }}>{l.missionRepere ?? l.missionId}</td>
                  <td style={{ padding: "6px 8px" }}>{l.missionStatut}</td>
                  <td style={{ padding: "6px 8px" }}><Badge valeur={l.statut} /></td>
                  <td style={{ padding: "6px 8px", color: grisTexte }}>{l.rationale ?? "—"}</td>
                  <td style={{ padding: "6px 8px", fontSize: 12, color: grisTexte }}>{new Date(l.createdAt).toLocaleDateString("fr-FR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
