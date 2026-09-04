"use client";

import { useEffect, useState } from "react";
import { bleuFonce, grisTexte, bordure } from "@/lib/theme";

type Ingenieur = {
  id: string;
  email: string;
  createdAt: string;
  valideLe: string | null;
  premiereConnexionLe: string | null;
  desactive: boolean;
  profil: {
    nom: string;
    prenom: string | null;
    cvValide: boolean;
    disponibilite: string | null;
  } | null;
};

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR") : "—";
}

// Rubrique Admin listant les comptes ingénieurs validés (un compte en
// attente de validation reste dans /admin/comptes-en-attente ; une fois
// validé il apparaît ici, avec ses dates clés). Voir /api/ingenieurs.
export default function IngenieursPage() {
  const [ingenieurs, setIngenieurs] = useState<Ingenieur[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    fetch("/api/ingenieurs")
      .then((r) => r.json())
      .then((data) => {
        setIngenieurs(Array.isArray(data) ? data : []);
        setChargement(false);
      });
  }, []);

  if (chargement) return <div>Chargement...</div>;

  return (
    <div>
      <h1 style={{ marginBottom: 4, color: bleuFonce }}>Ingénieurs</h1>
      <p style={{ fontSize: 13, color: grisTexte, marginBottom: 20, maxWidth: 700 }}>
        Comptes ingénieurs validés — dès qu'un compte est validé depuis « Comptes en attente », il apparaît ici avec
        ses dates clés (création, validation, première connexion).
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
              <th style={{ padding: "6px 8px" }}>Prénom</th>
              <th style={{ padding: "6px 8px" }}>Nom</th>
              <th style={{ padding: "6px 8px" }}>Email</th>
              <th style={{ padding: "6px 8px" }}>Statut</th>
              <th style={{ padding: "6px 8px" }}>Compte créé le</th>
              <th style={{ padding: "6px 8px" }}>Validé le</th>
              <th style={{ padding: "6px 8px" }}>Première connexion</th>
            </tr>
          </thead>
          <tbody>
            {ingenieurs.map((i) => (
              <tr key={i.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 8px" }}>{i.profil?.prenom ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>{i.profil?.nom ?? "—"}</td>
                <td style={{ padding: "6px 8px" }}>{i.email}</td>
                <td style={{ padding: "6px 8px" }}>
                  {i.desactive ? (
                    <span style={{ color: "#d97706", fontWeight: 600 }}>Désactivé (temporaire)</span>
                  ) : (
                    <span style={{ color: "#16a34a", fontWeight: 600 }}>Actif</span>
                  )}
                </td>
                <td style={{ padding: "6px 8px" }}>{formatDate(i.createdAt)}</td>
                <td style={{ padding: "6px 8px" }}>{formatDate(i.valideLe)}</td>
                <td style={{ padding: "6px 8px" }}>{formatDate(i.premiereConnexionLe)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ingenieurs.length === 0 && (
          <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Aucun ingénieur validé pour l'instant.</p>
        )}
      </div>
    </div>
  );
}
