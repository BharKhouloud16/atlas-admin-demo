"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bleu, bordure, grisTexte } from "@/lib/theme";

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

  useEffect(() => {
    fetch("/api/talent/demandes")
      .then((r) => r.json())
      .then((d) => {
        setDemandes(Array.isArray(d) ? d : []);
        setChargement(false);
      });
  }, []);

  return (
    <div>
      <h1>Atlas Talent — demandes clients</h1>
      {chargement && <p style={{ color: "#888" }}>Chargement…</p>}
      {!chargement && demandes.length === 0 && <p style={{ color: "#888" }}>Aucune demande pour l&apos;instant.</p>}
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
