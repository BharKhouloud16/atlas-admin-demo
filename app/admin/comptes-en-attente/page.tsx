"use client";

import { useEffect, useState } from "react";

type CompteEnAttente = {
  id: string;
  email: string;
  role: "INGENIEUR" | "CLIENT";
  profil: { id: string; nom: string } | null;
  client: {
    id: string;
    nom: string;
    contactReferent: string | null;
    telephone: string | null;
    identifiantEntreprise: string | null;
    formeJuridique: string | null;
  } | null;
};

export default function ComptesEnAttentePage() {
  const [comptes, setComptes] = useState<CompteEnAttente[]>([]);
  const [typeContrat, setTypeContrat] = useState<Record<string, string>>({});
  const [montant, setMontant] = useState<Record<string, string>>({});

  function charger() {
    fetch("/api/comptes").then((r) => r.json()).then(setComptes);
  }
  useEffect(charger, []);

  async function valider(userId: string) {
    await fetch("/api/comptes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        typeContrat: typeContrat[userId] || undefined,
        montant: montant[userId] ? Number(montant[userId]) : undefined,
      }),
    });
    charger();
  }

  return (
    <div>
      <h1>Comptes en attente de validation</h1>
      {comptes.length === 0 && <p style={{ color: "#888" }}>Aucun compte en attente.</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {comptes.map((c) => (
          <li key={c.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 16 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>
              {c.role === "CLIENT" ? c.client?.nom : c.profil?.nom} — {c.email} ({c.role})
            </p>
            {c.role === "CLIENT" && c.client && (
              <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", fontSize: 13, color: "#4b5567" }}>
                {c.client.formeJuridique && <li>Forme juridique : {c.client.formeJuridique}</li>}
                {c.client.identifiantEntreprise && <li>Identifiant entreprise (RC/RNE) : {c.client.identifiantEntreprise}</li>}
                {c.client.contactReferent && <li>Contact : {c.client.contactReferent}</li>}
                {c.client.telephone && <li>Téléphone : {c.client.telephone}</li>}
              </ul>
            )}
            {c.role === "INGENIEUR" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <select onChange={(e) => setTypeContrat((s) => ({ ...s, [c.id]: e.target.value }))}>
                  <option value="">Type de contrat...</option>
                  <option value="SALARIE">Salarié</option>
                  <option value="FREELANCE">Freelance</option>
                  <option value="PORTAGE">Portage</option>
                </select>
                <input
                  type="number"
                  placeholder="Montant (salaire annuel ou TJM)"
                  onChange={(e) => setMontant((s) => ({ ...s, [c.id]: e.target.value }))}
                />
              </div>
            )}
            <button onClick={() => valider(c.id)} style={{ marginTop: 8 }}>Valider ce compte</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
