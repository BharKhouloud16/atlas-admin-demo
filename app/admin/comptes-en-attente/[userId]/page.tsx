"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

// COMPANY ATLAS — ENGINEER ACCESS & TRUST (09/10/2026).
//
// Dossier Admin complet d'une candidature (contrat §13) : Identité,
// Candidature (CV + InfoCV), Access Integrity (signaux explicables, jamais
// un score), Décision. Consomme STRICTEMENT GET/PATCH /api/comptes[...]
// (aucune route parallèle). Les 3 boutons de décision correspondent
// exactement aux actions backend existantes — jamais une action inventée
// côté UI.

type InfoCV = { id: string; categorie: string; libelle: string; valeur: string; valide: boolean };
type Decision = { id: string; decision: "APPROUVER" | "REFUSER" | "DEMANDER_INFORMATIONS"; raison: string | null; decidedByEmail: string; decidedAt: string };
type Signal = { cle: string; label: string; valeur: string };

type Dossier = {
  id: string;
  email: string;
  role: "INGENIEUR" | "CLIENT";
  createdAt: string;
  emailVerifie: boolean;
  actif: boolean;
  valideLe: string | null;
  profil: { id: string; nom: string; prenom: string | null; cvUrl: string | null; cvNomFichier: string | null; cvImporteLe: string | null; cvValide: boolean; infosCv: InfoCV[] } | null;
  client: { id: string; nom: string; contactReferent: string | null; telephone: string | null; identifiantEntreprise: string | null; formeJuridique: string | null } | null;
  accessIntegrity: Signal[];
  decisions: Decision[];
};

const LABEL_DECISION: Record<string, string> = {
  APPROUVER: "Approuvée",
  REFUSER: "Refusée",
  DEMANDER_INFORMATIONS: "Informations demandées",
};

export default function DossierCandidaturePage() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [erreur, setErreur] = useState("");
  const [raison, setRaison] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreurDecision, setErreurDecision] = useState("");

  function charger() {
    fetch(`/api/comptes/${params.userId}`)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? `Erreur ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        setDossier(d);
        setErreur("");
      })
      .catch((e) => setErreur(e.message));
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.userId]);

  async function decider(decision: "APPROUVER" | "REFUSER" | "DEMANDER_INFORMATIONS") {
    if (decision !== "APPROUVER" && !raison.trim()) {
      setErreurDecision("Une raison est requise pour refuser ou demander des informations.");
      return;
    }
    if (decision === "APPROUVER" && !confirm("Confirmer l'approbation de ce compte ?")) return;

    setEnvoi(true);
    setErreurDecision("");
    const res = await fetch("/api/comptes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: params.userId, decision, raison: raison.trim() || undefined }),
    });
    setEnvoi(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErreurDecision(d.error ?? "Échec de la décision.");
      return;
    }
    setRaison("");
    charger();
  }

  if (erreur) return <p style={{ color: "crimson" }}>{erreur}</p>;
  if (!dossier) return <p style={{ color: "#888" }}>Chargement…</p>;

  const nomAffiche = dossier.role === "CLIENT" ? dossier.client?.nom : dossier.profil?.prenom ? `${dossier.profil.prenom} ${dossier.profil.nom}` : dossier.profil?.nom;

  return (
    <div>
      <p style={{ marginBottom: 12 }}>
        <button onClick={() => router.push("/admin/comptes-en-attente")} style={{ fontSize: 13, background: "none", border: "none", color: "#2a4ab0", cursor: "pointer", padding: 0 }}>
          ← Comptes en attente
        </button>
      </p>

      <h1 style={{ marginTop: 0 }}>{nomAffiche} ({dossier.role})</h1>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16 }}>Identité</h2>
        <ul style={{ listStyle: "none", padding: 0, fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
          <li>Email : {dossier.email}</li>
          <li>Email vérifié : {dossier.emailVerifie ? "Oui" : "Non"}</li>
          <li>Date d&apos;inscription : {new Date(dossier.createdAt).toLocaleString("fr-FR")}</li>
          <li>Compte activé : {dossier.actif ? `Oui (le ${dossier.valideLe ? new Date(dossier.valideLe).toLocaleDateString("fr-FR") : "—"})` : "Non"}</li>
          {dossier.client?.telephone && <li>Téléphone : {dossier.client.telephone}</li>}
          {dossier.client?.contactReferent && <li>Contact référent : {dossier.client.contactReferent}</li>}
        </ul>
      </section>

      {dossier.profil && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16 }}>Candidature</h2>
          {dossier.profil.cvUrl ? (
            <p style={{ fontSize: 13 }}>
              CV importé le {dossier.profil.cvImporteLe ? new Date(dossier.profil.cvImporteLe).toLocaleDateString("fr-FR") : "—"} —{" "}
              <Link href={`/api/ingenieur/cv/fichier?profilId=${dossier.profil.id}`} target="_blank" style={{ color: "#2a4ab0" }}>
                Ouvrir le CV ({dossier.profil.cvNomFichier ?? "fichier"})
              </Link>{" "}
              — validé par le candidat : {dossier.profil.cvValide ? "Oui" : "Non"}
            </p>
          ) : (
            <p style={{ fontSize: 13, color: "#888" }}>Aucun CV importé pour l&apos;instant.</p>
          )}
          {dossier.profil.infosCv.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, fontSize: 13, display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
              {dossier.profil.infosCv.map((info) => (
                <li key={info.id}>
                  <strong>{info.libelle}</strong> : {info.valeur || "—"}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16 }}>Access Integrity</h2>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
          Signaux factuels, jamais un score — à vous d&apos;en juger la portée.
        </p>
        <ul style={{ listStyle: "none", padding: 0, fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
          {dossier.accessIntegrity.map((s) => (
            <li key={s.cle} style={{ display: "flex", justifyContent: "space-between", maxWidth: 480, borderBottom: "1px solid #f0f0f0", padding: "4px 0" }}>
              <span>{s.label}</span>
              <strong>{s.valeur}</strong>
            </li>
          ))}
        </ul>
      </section>

      {dossier.decisions.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16 }}>Historique des décisions</h2>
          <ul style={{ listStyle: "none", padding: 0, fontSize: 13, display: "flex", flexDirection: "column", gap: 6 }}>
            {dossier.decisions.map((d) => (
              <li key={d.id} style={{ border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
                <strong>{LABEL_DECISION[d.decision]}</strong> par {d.decidedByEmail} le {new Date(d.decidedAt).toLocaleString("fr-FR")}
                {d.raison && <div style={{ color: "#4b5567", marginTop: 2 }}>{d.raison}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!dossier.actif && (
        <section>
          <h2 style={{ fontSize: 16 }}>Décision</h2>
          <textarea
            placeholder="Raison (requise pour refuser ou demander des informations)"
            value={raison}
            onChange={(e) => setRaison(e.target.value)}
            style={{ width: "100%", maxWidth: 480, minHeight: 70, padding: 8, fontSize: 13, marginBottom: 8 }}
          />
          {erreurDecision && <p style={{ color: "crimson", fontSize: 13 }}>{erreurDecision}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => decider("APPROUVER")} disabled={envoi} style={{ padding: "8px 14px", background: "#1a7f4b", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
              Approuver
            </button>
            <button onClick={() => decider("DEMANDER_INFORMATIONS")} disabled={envoi} style={{ padding: "8px 14px", background: "#d97706", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
              Demander des informations
            </button>
            <button onClick={() => decider("REFUSER")} disabled={envoi} style={{ padding: "8px 14px", background: "#b91c1c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
              Refuser
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
