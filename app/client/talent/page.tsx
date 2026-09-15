"use client";

import { useEffect, useState } from "react";
import { bordure, grisTexte } from "@/lib/theme";
import { Card, Section, EmptyState, Badge, Bouton } from "@/components/client/primitives";

type DemandeTalent = {
  id: string;
  titre: string | null;
  description: string;
  statut: string;
  competencesExtraites: string[];
  senioriteSouhaitee: string | null;
  budgetTjmMax: number | null;
  budgetDevise: string;
  analyseProvider: string | null;
  createdAt: string;
};

const LABEL_STATUT: Record<string, string> = {
  SOUMISE: "Soumise",
  ANALYSEE: "Analysée",
  EN_MATCHING: "En cours de matching",
  SHORTLIST_ENVOYEE: "Shortlist reçue",
  CLOTUREE: "Clôturée",
};

// ATLAS TALENT V1 — espace Client : soumettre une demande en texte libre
// (l'AI Request Analyzer, voir lib/talent/analyseur.ts, en extrait
// aussitôt des critères indicatifs) et suivre son statut. Reprend le style
// et les conventions de fetch de /client (voir app/client/page.tsx) sans
// toucher à cette page existante.
export default function TalentClientPage() {
  const [demandes, setDemandes] = useState<DemandeTalent[]>([]);
  const [chargement, setChargement] = useState(true);

  function charger() {
    fetch("/api/talent/demandes")
      .then((r) => r.json())
      .then((d) => {
        setDemandes(Array.isArray(d) ? d : []);
        setChargement(false);
      });
  }

  useEffect(() => {
    charger();
  }, []);

  return (
    <div>
      <Section title="Exprimer un besoin">
        <p style={{ color: grisTexte, fontSize: 13, margin: "-4px 0 12px" }}>
          Décrivez votre besoin en quelques phrases : compétences, séniorité, budget indicatif.
          Notre analyseur en propose une première lecture, toujours revue par notre équipe avant tout matching.
        </p>
        <FormulaireDemande onCree={charger} />
      </Section>

      <Section title="Vos demandes">
        {chargement && <EmptyState message="Chargement…" />}
        {!chargement && demandes.length === 0 && <EmptyState message="Aucune demande pour l'instant." />}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {demandes.map((d) => (
            <Card key={d.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{d.titre ?? d.description.slice(0, 60)}</p>
                <Badge variant="info">{LABEL_STATUT[d.statut] ?? d.statut}</Badge>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: grisTexte }}>{d.description}</p>
              {d.competencesExtraites.length > 0 && (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "#888" }}>
                  Compétences détectées : {d.competencesExtraites.join(", ")}
                  {d.senioriteSouhaitee ? ` · Séniorité : ${d.senioriteSouhaitee}` : ""}
                </p>
              )}
              {d.budgetTjmMax && (
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#888" }}>
                  Budget max : {d.budgetTjmMax} {d.budgetDevise}/jour
                </p>
              )}
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "#aaa" }}>
                Soumise le {new Date(d.createdAt).toLocaleDateString("fr-FR")}
              </p>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
}

function FormulaireDemande({ onCree }: { onCree: () => void }) {
  const [description, setDescription] = useState("");
  const [budgetTjmMax, setBudgetTjmMax] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer() {
    setErreur(null);
    setEnvoi(true);
    const reponse = await fetch("/api/talent/demandes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        budgetTjmMax: budgetTjmMax ? Number(budgetTjmMax) : undefined,
      }),
    });
    setEnvoi(false);
    if (!reponse.ok) {
      const data = await reponse.json().catch(() => ({}));
      setErreur(data.error ?? "Une erreur est survenue.");
      return;
    }
    setDescription("");
    setBudgetTjmMax("");
    onCree();
  }

  return (
    <div style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 12 }}>
      <textarea
        placeholder="Ex. : Recherche un ingénieur QA Senior, compétence Playwright, budget 600 EUR/jour, démarrage début octobre."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={4}
        style={{ width: "100%", padding: 8, fontFamily: "inherit", marginBottom: 8, border: `1px solid ${bordure}`, borderRadius: 6 }}
      />
      <input
        type="number"
        placeholder="Budget TJM max (facultatif, EUR)"
        value={budgetTjmMax}
        onChange={(e) => setBudgetTjmMax(e.target.value)}
        style={{ padding: 8, border: `1px solid ${bordure}`, borderRadius: 6, marginBottom: 8, width: 240 }}
      />
      {erreur && <p style={{ color: "#c0392b", fontSize: 13, margin: "0 0 8px" }}>{erreur}</p>}
      <div>
        <Bouton onClick={envoyer} disabled={description.trim().length < 10 || envoi}>
          {envoi ? "Envoi…" : "Soumettre la demande"}
        </Bouton>
      </div>
    </div>
  );
}
