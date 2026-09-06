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
  anneesExperienceMin: number | null;
  secteurActivite: string | null;
  localisation: string | null;
  mobilite: string | null;
  disponibiliteSouhaitee: string | null;
  budgetTjmMax: number | null;
  budgetDevise: string;
  analyseProvider: string | null;
  criteresModifiesParEmail: string | null;
  criteresModifiesLe: string | null;
};

const LABEL_STATUT_ENTREE: Record<string, string> = {
  SUGGEREE: "À valider",
  VALIDEE: "Validée",
  REJETEE: "Rejetée",
};

// Détail d'une DemandeTalent côté Admin : vérifier/modifier les critères de
// matching (voir PATCH /api/talent/demandes/[id]) PUIS déclencher le
// Matching Engine (lib/talent/matching.ts), qui relit ces mêmes champs en
// base — modifier les critères ici change directement son résultat. Le
// détail de la demande est relu depuis GET /api/talent/demandes (liste déjà
// existante, filtrée côté client) pour ne pas dupliquer une route de lecture.
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
        {demande.analyseProvider ? `Analyse initiale : ${demande.analyseProvider}` : "Pas encore analysée automatiquement"}
      </p>

      <CriteresMatching demande={demande} onEnregistre={setDemande} />

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

const champStyle: React.CSSProperties = { padding: 8, border: `1px solid ${bordure}`, borderRadius: 6, fontSize: 13, width: "100%" };
const labelStyle: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", color: "#888", display: "block", marginBottom: 4 };

// Zone "Critères de matching" — c'est CE que lit le Matching Engine (voir
// POST /api/talent/demandes/[id]/matching), jamais la description brute
// directement. L'Admin vérifie ici ce que l'AI Request Analyzer a proposé
// et corrige avant de lancer le matching (human-in-the-loop, même principe
// que la validation de shortlist plus bas).
function CriteresMatching({ demande, onEnregistre }: { demande: DemandeAdmin; onEnregistre: (d: DemandeAdmin) => void }) {
  const [competences, setCompetences] = useState(demande.competencesExtraites.join(", "));
  const [seniorite, setSeniorite] = useState(demande.senioriteSouhaitee ?? "");
  const [anneesExperience, setAnneesExperience] = useState(demande.anneesExperienceMin?.toString() ?? "");
  const [secteur, setSecteur] = useState(demande.secteurActivite ?? "");
  const [localisation, setLocalisation] = useState(demande.localisation ?? "");
  const [mobilite, setMobilite] = useState(demande.mobilite ?? "");
  const [disponibilite, setDisponibilite] = useState(demande.disponibiliteSouhaitee ?? "");
  const [budgetTjmMax, setBudgetTjmMax] = useState(demande.budgetTjmMax?.toString() ?? "");
  const [budgetDevise, setBudgetDevise] = useState(demande.budgetDevise);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function enregistrer() {
    setErreur(null);
    setEnregistrement(true);
    const reponse = await fetch(`/api/talent/demandes/${demande.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        competencesExtraites: competences.split(",").map((c) => c.trim()).filter(Boolean),
        senioriteSouhaitee: seniorite || null,
        anneesExperienceMin: anneesExperience ? Number(anneesExperience) : null,
        secteurActivite: secteur || null,
        localisation: localisation || null,
        mobilite: mobilite || null,
        disponibiliteSouhaitee: disponibilite || null,
        budgetTjmMax: budgetTjmMax ? Number(budgetTjmMax) : null,
        budgetDevise,
      }),
    });
    setEnregistrement(false);
    if (!reponse.ok) {
      const data = await reponse.json().catch(() => ({}));
      setErreur(data.error ?? "Une erreur est survenue.");
      return;
    }
    const misAJour = await reponse.json();
    onEnregistre(misAJour);
  }

  return (
    <div style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 16, margin: "16px 0" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 15 }}>Critères de matching</h2>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "#888" }}>
        Vérifiez et corrigez ces critères avant de lancer le matching — c&apos;est ce qui est réellement comparé aux profils.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Compétences / technologies recherchées (séparées par des virgules)</label>
          <input value={competences} onChange={(e) => setCompetences(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>Séniorité</label>
          <select value={seniorite} onChange={(e) => setSeniorite(e.target.value)} style={champStyle}>
            <option value="">—</option>
            <option value="Junior">Junior</option>
            <option value="Confirmé">Confirmé</option>
            <option value="Senior">Senior</option>
            <option value="Expert">Expert</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Années d&apos;expérience minimum</label>
          <input type="number" min={0} value={anneesExperience} onChange={(e) => setAnneesExperience(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>Secteur / contexte</label>
          <input value={secteur} onChange={(e) => setSecteur(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>Localisation</label>
          <input value={localisation} onChange={(e) => setLocalisation(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>Mobilité</label>
          <select value={mobilite} onChange={(e) => setMobilite(e.target.value)} style={champStyle}>
            <option value="">—</option>
            <option value="Remote">Remote</option>
            <option value="Hybride">Hybride</option>
            <option value="Sur site">Sur site</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Disponibilité souhaitée</label>
          <input value={disponibilite} onChange={(e) => setDisponibilite(e.target.value)} style={champStyle} placeholder="Ex. Immédiate" />
        </div>
        <div>
          <label style={labelStyle}>Budget TJM max</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input type="number" min={0} value={budgetTjmMax} onChange={(e) => setBudgetTjmMax(e.target.value)} style={champStyle} />
            <input value={budgetDevise} onChange={(e) => setBudgetDevise(e.target.value.toUpperCase())} maxLength={3} style={{ ...champStyle, width: 60 }} />
          </div>
        </div>
      </div>
      {erreur && <p style={{ color: "#c0392b", fontSize: 13, margin: "12px 0 0" }}>{erreur}</p>}
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={enregistrer}
          disabled={enregistrement}
          style={{ fontSize: 13, padding: "8px 16px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
        >
          {enregistrement ? "Enregistrement…" : "Enregistrer les critères"}
        </button>
        {demande.criteresModifiesLe && demande.criteresModifiesParEmail && (
          <span style={{ fontSize: 11, color: "#888" }}>
            Dernière modification par {demande.criteresModifiesParEmail} le{" "}
            {new Date(demande.criteresModifiesLe).toLocaleString("fr-FR")}
          </span>
        )}
      </div>
    </div>
  );
}
