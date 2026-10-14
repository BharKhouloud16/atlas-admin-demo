"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// COMPANY ATLAS — ENGINEER ACCESS & TRUST (09/10/2026).
//
// Espace candidature limité (contrat §7) : accessible après vérification
// de l'email, avant toute décision Admin. Consomme STRICTEMENT
// GET /api/ingenieur/candidature (sa propre candidature uniquement, aucun
// paramètre d'id possible). Aucune mutation ici — la seule action
// disponible est d'importer/compléter son CV (page existante, réutilisée
// telle quelle, voir /ingenieur/cv).

type Statut = {
  emailVerifie: boolean;
  actif: boolean;
  derniereDecision: { decision: "APPROUVER" | "REFUSER" | "DEMANDER_INFORMATIONS"; raison: string | null; decidedAt: string } | null;
};

const LABEL_DECISION: Record<string, string> = {
  APPROUVER: "Approuvée",
  REFUSER: "Non retenue",
  DEMANDER_INFORMATIONS: "Informations complémentaires demandées",
};

export default function CandidatureStatutPage() {
  const [statut, setStatut] = useState<Statut | null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    fetch("/api/ingenieur/candidature")
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? "Erreur lors du chargement de votre candidature.");
        }
        return r.json();
      })
      .then(setStatut)
      .catch((e) => setErreur(e.message));
  }, []);

  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Votre candidature</h1>
      <p style={{ fontSize: 14, color: "#4b5567", marginBottom: 24 }}>
        Votre compte n&apos;est pas encore activé — notre équipe examine votre dossier. Vous pouvez compléter votre
        CV pendant ce temps.
      </p>

      {erreur && <p style={{ color: "crimson", fontSize: 13 }}>{erreur}</p>}

      {statut && (
        <div style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <p style={{ margin: "0 0 6px", fontSize: 13 }}>
            Email vérifié : <strong>{statut.emailVerifie ? "Oui" : "Non"}</strong>
          </p>
          <p style={{ margin: 0, fontSize: 13 }}>
            Compte activé : <strong>{statut.actif ? "Oui" : "Non — en attente de décision"}</strong>
          </p>

          {statut.derniereDecision && statut.derniereDecision.decision !== "APPROUVER" && (
            <div style={{ marginTop: 12, padding: 10, background: "#fffaf0", border: "1px solid #f3c56b", borderRadius: 6 }}>
              <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600 }}>
                {LABEL_DECISION[statut.derniereDecision.decision]}
              </p>
              {statut.derniereDecision.raison && (
                <p style={{ margin: 0, fontSize: 13, color: "#4b5567" }}>{statut.derniereDecision.raison}</p>
              )}
            </div>
          )}
        </div>
      )}

      <Link href="/ingenieur/cv" style={{ display: "inline-block", padding: "10px 16px", background: "#12224a", color: "#fff", textDecoration: "none", borderRadius: 6, fontSize: 14 }}>
        Importer / mettre à jour mon CV
      </Link>
    </main>
  );
}
