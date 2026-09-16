"use client";

import { useEffect, useState } from "react";
import { grisTexte, bleu } from "@/lib/theme";
import { Card, Section, EmptyState } from "@/components/client/primitives";

// LOT 1 — Client Workspace Foundation (15/09/2026) : rubrique "Documents",
// extraite de l'ancien dashboard (app/client/page.tsx) — même appel API
// (GET /api/client/documents), même regroupement par type.
//
// CLIENT COMPLETION PROGRAM — C6 (16/09/2026) : fileUrl n'est plus exposé
// par l'API (URL de stockage privée) — le téléchargement passe par
// GET /api/client/documents/[id]/fichier.

type DocumentClient = {
  id: string;
  titre: string;
  type: string;
  createdAt: string;
};

const LABEL_TYPE: Record<string, string> = {
  CONTRAT: "Contrats",
  FACTURE: "Factures",
  RAPPORT_AUDIT: "Rapports",
  AUTRE: "Autres documents",
};

// Ordre d'affichage volontaire (contrats et factures d'abord, ce que le
// client vient chercher le plus souvent) — jamais un tri par volume ou une
// heuristique, un ordre fixe et prévisible.
const ORDRE_TYPES = ["CONTRAT", "FACTURE", "RAPPORT_AUDIT", "AUTRE"];

export default function DocumentsClientPage() {
  const [documents, setDocuments] = useState<DocumentClient[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    fetch("/api/client/documents")
      .then((r) => r.json())
      .then((d) => {
        setDocuments(Array.isArray(d) ? d : []);
        setChargement(false);
      });
  }, []);

  const groupes = ORDRE_TYPES.map((type) => ({
    type,
    documents: documents.filter((d) => d.type === type),
  })).filter((g) => g.documents.length > 0);

  return (
    <div>
      <Section title="Documents">
        {chargement && <EmptyState message="Chargement…" />}
        {!chargement && documents.length === 0 && <EmptyState message="Aucun document disponible pour l'instant." />}
      </Section>

      {groupes.map((g) => (
        <Section key={g.type} title={LABEL_TYPE[g.type] ?? g.type}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {g.documents.map((d) => (
              <Card key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>{d.titre}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 13, color: grisTexte }}>
                    {new Date(d.createdAt).toLocaleDateString("fr-FR")}
                  </p>
                </div>
                <a href={`/api/client/documents/${d.id}/fichier`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: bleu, fontWeight: 600 }}>
                  Télécharger
                </a>
              </Card>
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}
