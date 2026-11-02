"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bleu, bordure, grisTexte, rouge } from "@/lib/theme";

type DemandeAdmin = {
  id: string;
  titre: string | null;
  description: string;
  statut: string;
  client: { nom: string };
  competencesExtraites: string[];
  senioriteSouhaitee: string | null;
  createdAt: string;
  _count: { shortlist: number };
};

const LABEL_STATUT: Record<string, string> = {
  SOUMISE: "Soumise",
  ANALYSEE: "Analysée",
  EN_MATCHING: "En matching",
  SHORTLIST_ENVOYEE: "Shortlist envoyée",
  CLOTUREE: "Clôturée",
};

// ATLAS TALENT V1 — vue Admin : liste de toutes les DemandeTalent, tous
// clients confondus (même principe que /admin/missions). Le détail
// (lancer le Matching Engine, valider/rejeter la shortlist) est sur
// /admin/talent/[id].
export default function TalentAdminPage() {
  const [demandes, setDemandes] = useState<DemandeAdmin[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState("");

  function charger() {
    setChargement(true);
    setErreurChargement("");
    fetch("/api/talent/demandes")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        setDemandes(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        // FIX (19/10/2026) — même défaut que /admin/clients : sans ce
        // catch, un 403/500/réseau laissait `chargement` bloqué à `true`.
        setErreurChargement("Impossible de charger les demandes. Vérifiez votre connexion et réessayez.");
      })
      .finally(() => setChargement(false));
  }
  useEffect(charger, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1>Atlas Talent — demandes clients</h1>
        <Link
          href="/admin/talent/besoins"
          style={{ fontSize: 13, fontWeight: 600, color: bleu, textDecoration: "none", padding: "8px 14px", border: `1px solid ${bleu}`, borderRadius: 6 }}
        >
          Besoins clients à examiner →
        </Link>
      </div>
      {chargement && <p style={{ color: "#888" }}>Chargement…</p>}
      {!chargement && erreurChargement && (
        <div>
          <p role="alert" style={{ color: rouge, fontSize: 13, margin: "0 0 8px" }}>{erreurChargement}</p>
          <button
            onClick={charger}
            style={{ fontSize: 13, padding: "6px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
          >
            Réessayer
          </button>
        </div>
      )}
      {!chargement && !erreurChargement && demandes.length === 0 && <p style={{ color: "#888" }}>Aucune demande pour l&apos;instant.</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {demandes.map((d) => (
          <li key={d.id}>
            <Link
              href={`/admin/talent/${d.id}`}
              style={{ display: "block", border: `1px solid ${bordure}`, borderRadius: 8, padding: 12, textDecoration: "none", color: "inherit" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {d.titre ?? d.description.slice(0, 60)} <span style={{ color: grisTexte, fontWeight: 400 }}>— {d.client.nom}</span>
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>
                    {d.competencesExtraites.join(", ") || "Aucune compétence extraite"}
                    {d.senioriteSouhaitee ? ` · ${d.senioriteSouhaitee}` : ""} · {d._count.shortlist} profil(s) en shortlist
                  </p>
                </div>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: `1px solid ${bleu}`, color: bleu, whiteSpace: "nowrap" }}>
                  {LABEL_STATUT[d.statut] ?? d.statut}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
