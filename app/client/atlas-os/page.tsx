"use client";

import { useEffect, useState } from "react";
import { grisTexte } from "@/lib/theme";
import { Section, Card, EmptyState, Badge, type BadgeVariant } from "@/components/client/primitives";

// PHASE 7 — Service OS Foundation (22/09/2026). Premier flux Service OS
// réel (Decision Record Phase 6B) : remplace le placeholder LOT 1
// (BientotDisponible) maintenant que ServiceEngagement existe. Reprend le
// pattern déjà en usage sur cette même page (voir app/client/besoins/
// page.tsx, CarteBesoin) : liste de cartes, expansion au clic/clavier pour
// charger le détail (documents) à la demande, jamais tout précaché.
//
// Volontairement minimal : pas de recherche, pas de filtre, pas de
// pagination (voir mandat Phase 7 section 18 — "pas de dashboard Service
// OS"). Le téléchargement des Documents réutilise tel quel
// GET /api/client/documents/[id]/fichier — aucune nouvelle route de
// téléchargement Client n'a été créée (ownership déjà garantie par
// clientId sur Document, indépendamment de missionId/serviceEngagementId).

type ServiceEngagementListe = {
  id: string;
  titre: string;
  description: string | null;
  statut: string;
  createdAt: string;
};

type DocumentEngagement = { id: string; titre: string; type: string; createdAt: string };

type ServiceEngagementDetail = ServiceEngagementListe & {
  updatedAt: string;
  documents: DocumentEngagement[];
};

const VARIANT_STATUT: Record<string, BadgeVariant> = {
  "En cours": "info",
  Terminée: "success",
  Annulée: "error",
};

export default function AtlasOSClientPage() {
  const [engagements, setEngagements] = useState<ServiceEngagementListe[]>([]);
  const [chargement, setChargement] = useState(true);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, ServiceEngagementDetail>>({});

  useEffect(() => {
    fetch("/api/client/service-engagements")
      .then((r) => r.json())
      .then((d) => {
        setEngagements(d ?? []);
        setChargement(false);
      });
  }, []);

  function basculer(id: string) {
    const prochain = ouvert === id ? null : id;
    setOuvert(prochain);
    if (prochain && !detail[prochain]) {
      fetch(`/api/client/service-engagements/${prochain}`)
        .then((r) => r.json())
        .then((d) => setDetail((prev) => ({ ...prev, [prochain]: d })));
    }
  }

  return (
    <Section title="ATLAS OS / Services">
      {chargement && <EmptyState message="Chargement…" />}
      {!chargement && engagements.length === 0 && (
        <EmptyState message="Aucune prestation ATLAS OS / Services pour l'instant. Vos missions Talent restent visibles dans l'onglet Missions." />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {engagements.map((e) => {
          const estOuvert = ouvert === e.id;
          const d = detail[e.id];
          return (
            <Card key={e.id}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={estOuvert}
                style={{ cursor: "pointer" }}
                onClick={() => basculer(e.id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    basculer(e.id);
                  }
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 600 }}>{e.titre}</p>
                    {e.description && <p style={{ margin: "4px 0 0", fontSize: 13, color: grisTexte }}>{e.description}</p>}
                  </div>
                  <Badge variant={VARIANT_STATUT[e.statut] ?? "neutral"}>{e.statut}</Badge>
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "#94a0b3" }}>{new Date(e.createdAt).toLocaleDateString("fr-FR")}</p>
              </div>

              {estOuvert && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #eef0f4" }}>
                  {!d && <EmptyState message="Chargement…" />}
                  {d && d.documents.length === 0 && <EmptyState message="Aucun document pour l'instant." />}
                  {d && d.documents.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {d.documents.map((doc) => (
                        <a
                          key={doc.id}
                          href={`/api/client/documents/${doc.id}/fichier`}
                          style={{ fontSize: 13, color: "#2557d6", textDecoration: "none" }}
                        >
                          {doc.titre}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </Section>
  );
}
