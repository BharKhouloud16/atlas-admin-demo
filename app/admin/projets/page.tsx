"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bordure, grisTexte, rouge } from "@/lib/theme";
import { LIBELLE_STATUT_PROJET, type StatutProjetValeur } from "@/lib/projet/regles";

// LOT 6 (28/10/2026) — liste ADMIN des projets complets confiés par les clients.
type Ligne = {
  id: string;
  titre: string;
  type: "DELIVERY" | "SERVICE_ATLAS_OS";
  statut: StatutProjetValeur;
  client: string;
  derniereProposition: { version: number; niveau: string; statut: string } | null;
  manquants: string[];
  updatedAt: string;
};

export default function ProjetsAdminPage() {
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/projets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setLignes(d.projets ?? []))
      .catch(() => setErreur("Impossible de charger les projets."));
  }, []);
  return (
    <div>
      <h1 style={{ fontSize: 20 }}>Projets</h1>
      <p style={{ fontSize: 13, color: grisTexte }}>Qualifiez les projets, publiez des propositions indicatives puis vérifiées, confirmez les engagements et rattachez les missions.</p>
      {erreur && <p role="alert" style={{ color: rouge }}>{erreur}</p>}
      {lignes && lignes.length === 0 && <p style={{ fontSize: 13, color: grisTexte }}>Aucun projet pour l&apos;instant.</p>}
      {lignes && lignes.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "#fff" }}>
          <thead>
            <tr style={{ textAlign: "left", color: grisTexte }}>
              <th style={{ padding: 8 }}>Projet</th>
              <th style={{ padding: 8 }}>Client</th>
              <th style={{ padding: 8 }}>Statut</th>
              <th style={{ padding: 8 }}>Dernière proposition</th>
              <th style={{ padding: 8 }}>À compléter</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id} style={{ borderTop: `1px solid ${bordure}` }}>
                <td style={{ padding: 8 }}>
                  <Link href={`/admin/projets/${l.id}`}>{l.titre}</Link>
                  {l.type === "SERVICE_ATLAS_OS" && <span style={{ color: grisTexte }}> · ATLAS OS</span>}
                </td>
                <td style={{ padding: 8 }}>{l.client}</td>
                <td style={{ padding: 8 }}>{LIBELLE_STATUT_PROJET[l.statut]}</td>
                <td style={{ padding: 8 }}>{l.derniereProposition ? `v${l.derniereProposition.version} · ${l.derniereProposition.niveau.toLowerCase()} · ${l.derniereProposition.statut.toLowerCase()}` : "—"}</td>
                <td style={{ padding: 8, color: grisTexte }}>{l.manquants.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
