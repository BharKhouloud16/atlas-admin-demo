"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { bleu, bleuFonce, grisTexte, bordure } from "@/lib/theme";

// PHASE 7 — Service OS Foundation. Détail Admin : statut/titre modifiables,
// upload de Document (source ou rapport). Pas de workflow d'approbation,
// pas de Finding/Evidence (hors scope, voir mandat section 4/8).

type DocumentEngagement = { id: string; titre: string; type: string; createdAt: string };

type Detail = {
  id: string;
  titre: string;
  description: string | null;
  statut: string;
  createdAt: string;
  updatedAt: string;
  client: { id: string; nom: string };
  documents: DocumentEngagement[];
};

const STATUTS = ["En cours", "Terminée", "Annulée"];

export default function ServiceEngagementDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [chargement, setChargement] = useState(true);
  const [fichier, setFichier] = useState<File | null>(null);
  const [titreDocument, setTitreDocument] = useState("");
  const [typeDocument, setTypeDocument] = useState<"AUTRE" | "RAPPORT_AUDIT">("AUTRE");
  const [envoiDocument, setEnvoiDocument] = useState(false);
  const [erreurDocument, setErreurDocument] = useState("");

  function charger() {
    fetch(`/api/service-engagements/${params.id}`)
      .then((r) => r.json())
      .then((d) => {
        setDetail(d);
        setChargement(false);
      });
  }
  useEffect(charger, [params.id]);

  async function changerStatut(statut: string) {
    await fetch(`/api/service-engagements/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statut }),
    });
    charger();
  }

  async function uploaderDocument(e: React.FormEvent) {
    e.preventDefault();
    setErreurDocument("");
    if (!fichier) {
      setErreurDocument("Fichier requis.");
      return;
    }
    if (!titreDocument.trim()) {
      setErreurDocument("Titre requis.");
      return;
    }
    setEnvoiDocument(true);
    const form = new FormData();
    form.set("fichier", fichier);
    form.set("titre", titreDocument);
    form.set("type", typeDocument);
    const res = await fetch(`/api/service-engagements/${params.id}/documents`, { method: "POST", body: form });
    setEnvoiDocument(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErreurDocument(d.error ?? "Erreur, réessayez.");
      return;
    }
    setFichier(null);
    setTitreDocument("");
    charger();
  }

  if (chargement) return <div>Chargement...</div>;
  if (!detail) return <div>Prestation introuvable.</div>;

  return (
    <div>
      <h1 style={{ marginBottom: 4, color: bleuFonce }}>{detail.titre}</h1>
      <p style={{ fontSize: 13, color: grisTexte, margin: "0 0 20px" }}>
        Client : {detail.client.nom} — Créée le {new Date(detail.createdAt).toLocaleDateString("fr-FR")}
      </p>

      {detail.description && <p style={{ fontSize: 14, marginBottom: 20 }}>{detail.description}</p>}

      <div style={{ marginBottom: 24 }}>
        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Statut</label>
        <select value={detail.statut} onChange={(e) => changerStatut(e.target.value)}>
          {STATUTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <h2 style={{ fontSize: 16, color: bleuFonce, marginBottom: 10 }}>Documents</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
        {detail.documents.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>Aucun document pour l'instant.</p>}
        {detail.documents.map((doc) => (
          <a
            key={doc.id}
            href={`/api/service-engagements/${detail.id}/documents/${doc.id}/fichier`}
            style={{ fontSize: 13, color: bleu, textDecoration: "none" }}
          >
            {doc.titre} ({doc.type}) — {new Date(doc.createdAt).toLocaleDateString("fr-FR")}
          </a>
        ))}
      </div>

      <form
        onSubmit={uploaderDocument}
        style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 640 }}
      >
        <input placeholder="Titre du document *" value={titreDocument} onChange={(e) => setTitreDocument(e.target.value)} required />
        <select value={typeDocument} onChange={(e) => setTypeDocument(e.target.value as "AUTRE" | "RAPPORT_AUDIT")}>
          <option value="AUTRE">Autre / Source</option>
          <option value="RAPPORT_AUDIT">Rapport d'audit</option>
        </select>
        <input
          type="file"
          onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
          style={{ gridColumn: "1 / -1" }}
          required
        />
        {erreurDocument && <p style={{ color: "crimson", fontSize: 13, gridColumn: "1 / -1", margin: 0 }}>{erreurDocument}</p>}
        <div style={{ gridColumn: "1 / -1" }}>
          <button type="submit" disabled={envoiDocument} style={{ fontSize: 13, padding: "8px 16px" }}>
            {envoiDocument ? "Envoi..." : "Attacher le document"}
          </button>
        </div>
      </form>
    </div>
  );
}
