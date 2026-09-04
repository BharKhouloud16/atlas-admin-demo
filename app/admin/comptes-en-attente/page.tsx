"use client";

import { useEffect, useState } from "react";

type CompteEnAttente = {
  id: string;
  email: string;
  role: "INGENIEUR" | "CLIENT";
  createdAt: string;
  profil: { id: string; nom: string; prenom: string | null } | null;
  client: {
    id: string;
    nom: string;
    contactReferent: string | null;
    telephone: string | null;
    identifiantEntreprise: string | null;
    formeJuridique: string | null;
  } | null;
};

// Alerte simple : un compte en attente depuis plus de 48h mérite d'être
// traité en priorité (le prospect/candidat attend une réponse).
const SEUIL_ALERTE_HEURES = 48;
function heuresEnAttente(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60));
}

const PAR_PAGE = 10;

export default function ComptesEnAttentePage() {
  const [comptes, setComptes] = useState<CompteEnAttente[]>([]);
  const [page, setPage] = useState(1);

  function charger() {
    fetch("/api/comptes").then((r) => r.json()).then(setComptes);
  }
  useEffect(charger, []);

  const nombrePages = Math.max(1, Math.ceil(comptes.length / PAR_PAGE));
  const pageEffective = Math.min(page, nombrePages);
  const comptesPage = comptes.slice((pageEffective - 1) * PAR_PAGE, pageEffective * PAR_PAGE);

  async function valider(userId: string) {
    await fetch("/api/comptes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    charger();
  }

  return (
    <div>
      <h1>Comptes en attente de validation</h1>
      {comptes.length === 0 && <p style={{ color: "#888" }}>Aucun compte en attente.</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {comptesPage.map((c) => {
          const heures = heuresEnAttente(c.createdAt);
          const enAlerte = heures >= SEUIL_ALERTE_HEURES;
          return (
          <li key={c.id} style={{ border: "1px solid " + (enAlerte ? "#f3c56b" : "#eee"), background: enAlerte ? "#fffaf0" : undefined, borderRadius: 8, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>
                {c.role === "CLIENT"
                  ? c.client?.nom
                  : c.profil?.prenom
                  ? `${c.profil.prenom} ${c.profil.nom}`
                  : c.profil?.nom}{" "}
                — {c.email} ({c.role})
              </p>
              {enAlerte && (
                <span style={{ fontSize: 11, fontWeight: 600, color: "#b45309", whiteSpace: "nowrap" }}>
                  ⚠ en attente depuis {Math.floor(heures / 24)}j
                </span>
              )}
            </div>
            {c.role === "CLIENT" && c.client && (
              <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", fontSize: 13, color: "#4b5567" }}>
                {c.client.formeJuridique && <li>Forme juridique : {c.client.formeJuridique}</li>}
                {c.client.identifiantEntreprise && <li>Identifiant entreprise (RC/RNE) : {c.client.identifiantEntreprise}</li>}
                {c.client.contactReferent && <li>Contact : {c.client.contactReferent}</li>}
                {c.client.telephone && <li>Téléphone : {c.client.telephone}</li>}
              </ul>
            )}
            {c.role === "INGENIEUR" && (
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "#888" }}>
                Le type de contrat et le TJM seront déterminés après import et validation de son CV.
              </p>
            )}
            <button onClick={() => valider(c.id)} style={{ marginTop: 8 }}>Valider ce compte</button>
          </li>
          );
        })}
      </ul>
      {nombrePages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 16 }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={pageEffective <= 1}
            style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #ccc", background: "#fff", cursor: pageEffective <= 1 ? "default" : "pointer", opacity: pageEffective <= 1 ? 0.4 : 1 }}
          >
            ← Précédent
          </button>
          <span style={{ fontSize: 13, color: "#667" }}>
            Page {pageEffective} / {nombrePages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(nombrePages, p + 1))}
            disabled={pageEffective >= nombrePages}
            style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #ccc", background: "#fff", cursor: pageEffective >= nombrePages ? "default" : "pointer", opacity: pageEffective >= nombrePages ? 0.4 : 1 }}
          >
            Suivant →
          </button>
        </div>
      )}
    </div>
  );
}
