"use client";

import { useEffect, useState } from "react";

type Mission = {
  id: string;
  repere: string | null;
  statut: string;
  nbJours: number;
  createdAt: string;
  profil: { nom: string };
};

type Document = {
  id: string;
  titre: string;
  type: string;
  fileUrl: string;
  createdAt: string;
};

export default function ClientDashboard() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);

  useEffect(() => {
    fetch("/api/client/missions").then((r) => r.json()).then(setMissions);
    fetch("/api/client/documents").then((r) => r.json()).then(setDocuments);
  }, []);

  return (
    <div>
      <h1>Suivi de vos missions</h1>
      {missions.length === 0 && <p style={{ color: "#888" }}>Aucune mission pour l'instant.</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {missions.map((m) => (
          <li key={m.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{m.repere ?? m.profil.nom}</p>
            <p style={{ margin: 0, fontSize: 13, color: "#666" }}>
              Statut : {m.statut} · {m.nbJours} jour(s) · démarrée le {new Date(m.createdAt).toLocaleDateString("fr-FR")}
            </p>
          </li>
        ))}
      </ul>

      <h1 style={{ marginTop: 32 }}>Vos documents</h1>
      {documents.length === 0 && <p style={{ color: "#888" }}>Aucun document disponible pour l'instant.</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {documents.map((d) => (
          <li key={d.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, display: "flex", justifyContent: "space-between" }}>
            <div>
              <p style={{ margin: 0, fontWeight: 600 }}>{d.titre}</p>
              <p style={{ margin: 0, fontSize: 13, color: "#666" }}>{d.type} · {new Date(d.createdAt).toLocaleDateString("fr-FR")}</p>
            </div>
            <a href={d.fileUrl} target="_blank" rel="noopener noreferrer">Télécharger</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
