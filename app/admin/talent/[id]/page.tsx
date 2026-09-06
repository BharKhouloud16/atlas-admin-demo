"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { bleu, bordure, grisTexte } from "@/lib/theme";

type Motif = { critere: string; poidsPct?: number; detail: string };

type ShortlistEntree = {
  id: string;
  profilId: string;
  score: number;
  confiance: number;
  motifs: Motif[];
  statut: "SUGGEREE" | "VALIDEE" | "REJETEE";
  profil: { nom: string; prenom: string | null };
};

type DemandeAdmin = {
  id: string;
  titre: string | null;
  description: string;
  statut: string;
  client: { nom: string };
  competencesExtraites: string[];
  senioriteSouhaitee: string | null;
  budgetTjmMax: number | null;
  budgetDevise: string;
  analyseProvider: string | null;
};

const LABEL_STATUT_ENTREE: Record<string, string> = {
  SUGGEREE: "À valider",
  VALIDEE: "Validée",
  REJETEE: "Rejetée",
};

// Détail d'une DemandeTalent côté Admin : déclenche le Matching Engine
// (lib/talent/matching.ts) et valide/rejette chaque suggestion — jamais
// automatique (human-in-the-loop, voir POST .../shortlist). Le détail de la
// demande elle-même est relu depuis GET /api/talent/demandes (liste déjà
// existante, filtrée côté client) pour ne pas dupliquer une route pour un
// simple affichage.
export default function TalentAdminDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [demande, setDemande] = useState<DemandeAdmin | null>(null);
  const [shortlist, setShortlist] = useState<ShortlistEntree[]>([]);
  const [chargement, setChargement] = useState(true);
  const [matchingEnCours, setMatchingEnCours] = useState(false);
  const [decisionEnCours, setDecisionEnCours] = useState<string | null>(null);

  function chargerShortlist() {
    fetch(`/api/talent/demandes/${id}/matching`)
      .then((r) => r.json())
      .then((d) => setShortlist(Array.isArray(d.shortlist) ? d.shortlist : []));
  }

  useEffect(() => {
    fetch("/api/talent/demandes")
      .then((r) => r.json())
      .then((liste) => {
        const trouvee = Array.isArray(liste) ? liste.find((d: DemandeAdmin) => d.id === id) : null;
        setDemande(trouvee ?? null);
        setChargement(false);
      });
    chargerShortlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function lancerMatching() {
    setMatchingEnCours(true);
    const reponse = await fetch(`/api/talent/demandes/${id}/matching`, { method: "POST" });
    setMatchingEnCours(false);
    if (reponse.ok) {
      const data = await reponse.json();
      setShortlist(Array.isArray(data.shortlist) ? data.shortlist : []);
    }
  }

  async function decider(profilId: string, decision: "VALIDEE" | "REJETEE") {
    setDecisionEnCours(profilId);
    await fetch(`/api/talent/demandes/${id}/shortlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profilId, decision }),
    });
    setDecisionEnCours(null);
    chargerShortlist();
  }

  if (chargement) return <p style={{ color: "#888" }}>Chargement…</p>;
  if (!demande) return <p style={{ color: "#888" }}>Demande introuvable.</p>;

  return (
    <div>
      <Link href="/admin/talent" style={{ fontSize: 13, color: bleu, textDecoration: "none" }}>
        ← Retour aux demandes
      </Link>
      <h1 style={{ marginTop: 8 }}>{demande.titre ?? "Demande sans titre"}</h1>
      <p style={{ color: grisTexte, fontSize: 13 }}>Client : {demande.client.nom}</p>
      <p style={{ fontSize: 14 }}>{demande.description}</p>
      <p style={{ fontSize: 12, color: "#888" }}>
        Compétences extraites : {demande.competencesExtraites.join(", ") || "aucune"}
        {demande.senioriteSouhaitee ? ` · Séniorité : ${demande.senioriteSouhaitee}` : ""}
        {demande.budgetTjmMax ? ` · Budget max : ${demande.budgetTjmMax} ${demande.budgetDevise}/jour` : ""}
        {demande.analyseProvider ? ` · Analyse : ${demande.analyseProvider}` : " · pas encore analysée"}
      </p>

      <div style={{ margin: "16px 0" }}>
        <button
          onClick={lancerMatching}
          disabled={matchingEnCours}
          style={{ fontSize: 13, padding: "8px 16px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
        >
          {matchingEnCours ? "Calcul en cours…" : "Lancer / recalculer le matching"}
        </button>
      </div>

      <h1>Shortlist</h1>
      {shortlist.length === 0 && (
        <p style={{ color: "#888" }}>
          Aucun profil proposé pour l&apos;instant — lancez le matching, ou aucun profil avec CV validé ne correspond.
        </p>
      )}
      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {shortlist.map((e) => (
          <li key={e.id} style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <p style={{ margin: 0, fontWeight: 600 }}>
                  {e.profil.prenom ? `${e.profil.prenom} ${e.profil.nom}` : e.profil.nom}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#888" }}>
                  Score {Math.round(e.score)}/100 · Confiance {Math.round(e.confiance * 100)}%
                </p>
              </div>
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: `1px solid ${e.statut === "REJETEE" ? "#c0392b" : bleu}`,
                  color: e.statut === "REJETEE" ? "#c0392b" : bleu,
                  whiteSpace: "nowrap",
                }}
              >
                {LABEL_STATUT_ENTREE[e.statut]}
              </span>
            </div>
            {Array.isArray(e.motifs) && e.motifs.length > 0 && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: grisTexte }}>
                {e.motifs.map((m, i) => (
                  <li key={i}>{m.detail}</li>
                ))}
              </ul>
            )}
            {e.statut === "SUGGEREE" && (
              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <button
                  onClick={() => decider(e.profilId, "VALIDEE")}
                  disabled={decisionEnCours === e.profilId}
                  style={{ fontSize: 12, padding: "6px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
                >
                  Valider
                </button>
                <button
                  onClick={() => decider(e.profilId, "REJETEE")}
                  disabled={decisionEnCours === e.profilId}
                  style={{ fontSize: 12, padding: "6px 12px", background: "none", color: "#c0392b", border: "1px solid #c0392b", borderRadius: 6, cursor: "pointer" }}
                >
                  Rejeter
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
