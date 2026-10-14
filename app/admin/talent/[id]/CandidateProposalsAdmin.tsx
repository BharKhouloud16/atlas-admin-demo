"use client";

import { useEffect, useState } from "react";
import { bleu, bordure, grisTexte, vert, rouge } from "@/lib/theme";
import { CANDIDATE_PROPOSAL_DEVISES_ACCEPTEES } from "@/lib/validation";

// ATLAS CANDIDATE PROPOSAL — UI ADMIN (A36.1, voir rapport A36.0 §7/§12).
// Extension du namespace existant app/admin/talent/[id]/page.tsx — même
// esthétique inline (champStyle/labelStyle/bleu/bordure déjà en usage dans
// ce fichier, patron InterviewsAdmin.tsx), aucun Modal. Consomme
// EXCLUSIVEMENT les 7 routes CandidateProposal déjà existantes et les
// lectures /final-decision + /selections (déjà existantes, utilisées ici en
// lecture seule pour proposer les entrées RETENU éligibles).
//
// A36.6 (décision A36.5) — la création de Mission depuis une proposition
// ACCEPTEE est désormais disponible : "profilId" n'est jamais saisi ici
// (résolu exclusivement côté serveur, voir lib/candidate-proposal/
// mission.ts) — ce composant ne fait que déclencher POST /api/missions
// (branche candidateProposalId déjà existante) avec les seuls champs
// commerciaux réellement nécessaires.

type CandidateProposalStatut = "BROUILLON" | "EMISE" | "ACCEPTEE" | "REFUSEE" | "RETIREE";

type CandidateProposal = {
  id: string;
  candidateFinalDecisionEntreeId: string;
  statut: CandidateProposalStatut;
  tjmPropose: number | null;
  devise: string | null;
  dureeJours: number | null;
  dateDebutEnvisagee: string | null;
  dateValidite: string | null;
  emisLe: string | null;
  emisParEmail: string | null;
  decideLe: string | null;
  decideParEmail: string | null;
  communiqueParClientHorsSysteme: boolean;
  canalHorsSysteme: string | null;
  retireeLe: string | null;
  createdByEmail: string;
  createdAt: string;
  // A36.6 — ajout additif (voir lib/candidate-proposal/proposal.ts),
  // présent uniquement si une Mission a déjà été créée pour cette
  // proposition.
  missionCreee: { id: string } | null;
};

type FinalDecisionEntree = { id: string; candidateSelectionId: string; statut: "RETENU" | "NON_RETENU" };

type SelectionAvecProfil = { id: string; shortlistEntree: { profil: { nom: string; prenom: string | null } } };

type EntreeEligible = { entree: FinalDecisionEntree; nomCandidat: string };

const champStyle: React.CSSProperties = { padding: 8, border: `1px solid ${bordure}`, borderRadius: 6, fontSize: 13, width: "100%" };
const labelStyle: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", color: "#888", display: "block", marginBottom: 4 };

const LABEL_STATUT: Record<CandidateProposalStatut, string> = {
  BROUILLON: "Brouillon",
  EMISE: "Émise",
  ACCEPTEE: "Acceptée",
  REFUSEE: "Refusée",
  RETIREE: "Retirée",
};

const COULEUR_STATUT: Record<CandidateProposalStatut, string> = {
  BROUILLON: grisTexte,
  EMISE: bleu,
  ACCEPTEE: vert,
  REFUSEE: rouge,
  RETIREE: "#888",
};

function PastilleStatut({ statut }: { statut: CandidateProposalStatut }) {
  const couleur = COULEUR_STATUT[statut];
  return (
    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur, whiteSpace: "nowrap" }}>
      {LABEL_STATUT[statut]}
    </span>
  );
}

export default function CandidateProposalsAdmin({ demandeId }: { demandeId: string }) {
  const [propositions, setPropositions] = useState<CandidateProposal[]>([]);
  const [entreesEligibles, setEntreesEligibles] = useState<EntreeEligible[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  async function charger() {
    const [rPropositions, rDecision, rSelections] = await Promise.all([
      fetch(`/api/talent/demandes/${demandeId}/candidate-proposals`),
      fetch(`/api/talent/demandes/${demandeId}/final-decision`),
      fetch(`/api/talent/demandes/${demandeId}/selections`),
    ]);
    setChargement(false);

    if (!rPropositions.ok) {
      const d = await rPropositions.json().catch(() => ({}));
      setErreur(d.error ?? "Impossible de charger les propositions commerciales.");
      return;
    }
    setErreur(null);
    const dataPropositions = await rPropositions.json();
    const listeActuelle: CandidateProposal[] = dataPropositions.propositions ?? [];
    setPropositions(listeActuelle);

    // final-decision/selections ne servent qu'à proposer de nouvelles
    // entrées éligibles — un échec sur ces deux lectures auxiliaires ne
    // doit jamais empêcher l'affichage des propositions déjà existantes.
    if (rDecision.ok && rSelections.ok) {
      const dataDecision = await rDecision.json();
      const dataSelections = await rSelections.json();
      const entrees: FinalDecisionEntree[] = dataDecision.active?.entrees ?? [];
      const selections: SelectionAvecProfil[] = dataSelections.selections ?? [];
      const profilParSelection = new Map(selections.map((s) => [s.id, s.shortlistEntree.profil]));

      // Même règle d'exclusivité que lib/candidate-proposal/proposal.ts
      // (étape e) — BROUILLON/EMISE/ACCEPTEE bloquent une nouvelle création
      // pour la même entrée. Filtre d'affichage uniquement : le serveur
      // revalide intégralement à la création (409 sinon).
      const eligibles = entrees
        .filter((e) => e.statut === "RETENU")
        .filter((e) => !listeActuelle.some((p) => p.candidateFinalDecisionEntreeId === e.id && ["BROUILLON", "EMISE", "ACCEPTEE"].includes(p.statut)))
        .map((e) => {
          const profil = profilParSelection.get(e.candidateSelectionId);
          const nomCandidat = profil ? (profil.prenom ? `${profil.prenom} ${profil.nom}` : profil.nom) : `Entrée ${e.id}`;
          return { entree: e, nomCandidat };
        });
      setEntreesEligibles(eligibles);
    } else {
      setEntreesEligibles([]);
    }
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demandeId]);

  if (chargement) return null;

  return (
    <div style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 16, margin: "16px 0" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 15 }}>Propositions commerciales</h2>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "#888" }}>
        Créez, émettez et suivez les propositions commerciales pour les candidats retenus — la décision d&apos;acceptation reste celle du Client, ou,
        si elle a été communiquée hors système, enregistrée ici avec le canal explicite.
      </p>

      {erreur && <p style={{ color: rouge, fontSize: 13, margin: "0 0 12px" }}>{erreur}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {propositions.length === 0 && <p style={{ color: "#888", fontSize: 13 }}>Aucune proposition commerciale pour l&apos;instant.</p>}
        {propositions.map((p) => (
          <PropositionLigne key={p.id} proposition={p} demandeId={demandeId} onChange={charger} />
        ))}
      </div>

      <FormulaireCreation demandeId={demandeId} entreesEligibles={entreesEligibles} onCree={charger} />
    </div>
  );
}

function PropositionLigne({ proposition, demandeId, onChange }: { proposition: CandidateProposal; demandeId: string; onChange: () => void }) {
  return (
    <div style={{ border: `1px solid ${bordure}`, borderRadius: 6, padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          {proposition.tjmPropose != null ? (
            <p style={{ margin: 0, fontSize: 13 }}>
              {proposition.tjmPropose} {proposition.devise}/jour · {proposition.dureeJours} jour(s)
            </p>
          ) : proposition.statut === "BROUILLON" ? (
            <p style={{ margin: 0, fontSize: 13, color: "#888" }}>Pas encore émise (brouillon)</p>
          ) : (
            // A36.3 — correction cosmétique (A36.2 §13.1) : une proposition
            // RETIREE jamais émise affichait encore "(brouillon)", en
            // contradiction avec le texte "Retirée le…" juste en dessous.
            // Correction purement textuelle/d'affichage — aucun statut ni
            // transition métier modifié.
            <p style={{ margin: 0, fontSize: 13, color: "#888" }}>Aucun snapshot commercial (jamais émise)</p>
          )}
          {proposition.dateDebutEnvisagee && (
            <p style={{ margin: "2px 0 0", fontSize: 11, color: grisTexte }}>
              Début envisagé : {new Date(proposition.dateDebutEnvisagee).toLocaleDateString("fr-FR")}
            </p>
          )}
          {proposition.dateValidite && (
            <p style={{ margin: "2px 0 0", fontSize: 11, color: grisTexte }}>
              Valable jusqu&apos;au {new Date(proposition.dateValidite).toLocaleDateString("fr-FR")}
            </p>
          )}
          {proposition.emisLe && (
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#888" }}>
              Émise le {new Date(proposition.emisLe).toLocaleDateString("fr-FR")} par {proposition.emisParEmail}
            </p>
          )}
        </div>
        <PastilleStatut statut={proposition.statut} />
      </div>

      {proposition.statut === "BROUILLON" && <FormulaireEmission proposition={proposition} demandeId={demandeId} onEmis={onChange} />}

      {proposition.statut === "EMISE" && (
        <>
          <FormulaireDecisionHorsSysteme proposition={proposition} demandeId={demandeId} onDecide={onChange} />
          <BoutonRetrait proposition={proposition} demandeId={demandeId} onRetire={onChange} />
        </>
      )}

      {proposition.statut === "BROUILLON" && <BoutonRetrait proposition={proposition} demandeId={demandeId} onRetire={onChange} />}

      {(proposition.statut === "ACCEPTEE" || proposition.statut === "REFUSEE") && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: grisTexte }}>
          Décidé le {proposition.decideLe ? new Date(proposition.decideLe).toLocaleDateString("fr-FR") : "—"} par{" "}
          {proposition.decideParEmail ?? "—"}
          {proposition.communiqueParClientHorsSysteme
            ? ` (communiqué hors système — ${proposition.canalHorsSysteme ?? "canal non précisé"})`
            : ""}
        </p>
      )}

      {proposition.statut === "ACCEPTEE" && <BoutonCreerMission proposition={proposition} onCree={onChange} />}

      {proposition.statut === "RETIREE" && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: grisTexte }}>
          Retirée{proposition.retireeLe ? ` le ${new Date(proposition.retireeLe).toLocaleDateString("fr-FR")}` : ""}.
        </p>
      )}
    </div>
  );
}

function FormulaireEmission({ proposition, demandeId, onEmis }: { proposition: CandidateProposal; demandeId: string; onEmis: () => void }) {
  const [tjmPropose, setTjmPropose] = useState("");
  const [devise, setDevise] = useState("EUR");
  const [dureeJours, setDureeJours] = useState("");
  const [dateDebutEnvisagee, setDateDebutEnvisagee] = useState("");
  const [dateValidite, setDateValidite] = useState("");
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const champsValides = tjmPropose.trim().length > 0 && Number(tjmPropose) > 0 && dureeJours.trim().length > 0 && Number.isInteger(Number(dureeJours)) && Number(dureeJours) > 0;

  async function emettre() {
    setErreur(null);
    setEnvoi(true);
    const reponse = await fetch(`/api/talent/demandes/${demandeId}/candidate-proposals/${proposition.id}/emettre`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tjmPropose: Number(tjmPropose),
        devise,
        dureeJours: Number(dureeJours),
        dateDebutEnvisagee: dateDebutEnvisagee || undefined,
        dateValidite: dateValidite || undefined,
      }),
    });
    setEnvoi(false);
    setConfirmationVisible(false);
    if (!reponse.ok) {
      const d = await reponse.json().catch(() => ({}));
      setErreur(d.error ?? "Émission impossible — l'état de cette proposition a peut-être changé.");
      onEmis(); // la liste peut avoir changé entre-temps (conflit de concurrence) — jamais un état figé localement
      return;
    }
    onEmis();
  }

  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${bordure}`, paddingTop: 10 }}>
      <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600 }}>Émettre cette proposition</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={labelStyle}>TJM proposé</label>
          <input
            type="number"
            min={1}
            aria-label="TJM proposé"
            value={tjmPropose}
            onChange={(e) => setTjmPropose(e.target.value)}
            style={champStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Devise</label>
          <select aria-label="Devise" value={devise} onChange={(e) => setDevise(e.target.value)} style={champStyle}>
            {CANDIDATE_PROPOSAL_DEVISES_ACCEPTEES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Durée (jours)</label>
          <input
            type="number"
            min={1}
            aria-label="Durée (jours)"
            value={dureeJours}
            onChange={(e) => setDureeJours(e.target.value)}
            style={champStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Date de début envisagée (optionnel)</label>
          <input
            type="date"
            aria-label="Date de début envisagée"
            value={dateDebutEnvisagee}
            onChange={(e) => setDateDebutEnvisagee(e.target.value)}
            style={champStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Date de validité (optionnel)</label>
          <input
            type="date"
            aria-label="Date de validité"
            value={dateValidite}
            onChange={(e) => setDateValidite(e.target.value)}
            style={champStyle}
          />
        </div>
      </div>
      {erreur && <p style={{ color: rouge, fontSize: 12, margin: "8px 0 0" }}>{erreur}</p>}

      {!confirmationVisible && (
        <button
          onClick={() => setConfirmationVisible(true)}
          disabled={!champsValides}
          style={{ marginTop: 10, fontSize: 12, padding: "6px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: champsValides ? "pointer" : "default", opacity: champsValides ? 1 : 0.6 }}
        >
          Émettre
        </button>
      )}
      {confirmationVisible && (
        <div style={{ marginTop: 10, border: `1px solid ${bleu}`, borderRadius: 6, padding: 10, background: "#eaf0fd" }}>
          <p style={{ margin: "0 0 8px", fontSize: 12 }}>
            Le snapshot commercial sera figé et la proposition deviendra visible par le Client. Confirmer l&apos;émission ?
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={emettre}
              disabled={envoi}
              style={{ fontSize: 12, padding: "6px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
            >
              {envoi ? "Émission…" : "Confirmer l'émission"}
            </button>
            <button
              onClick={() => setConfirmationVisible(false)}
              disabled={envoi}
              style={{ fontSize: 12, padding: "6px 12px", background: "#fff", color: grisTexte, border: `1px solid ${bordure}`, borderRadius: 6, cursor: "pointer" }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const CANAUX_HORS_SYSTEME_SUGGESTIONS = ["Téléphone", "Email", "Visite", "Autre"];

function FormulaireDecisionHorsSysteme({ proposition, demandeId, onDecide }: { proposition: CandidateProposal; demandeId: string; onDecide: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [reponse, setReponse] = useState<"ACCEPTEE" | "REFUSEE">("ACCEPTEE");
  const [canalHorsSysteme, setCanalHorsSysteme] = useState("");
  const [confirmeCommunique, setConfirmeCommunique] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Le littéral Zod `communiqueParClientHorsSysteme: true` est obligatoire
  // côté serveur — cette case à cocher reflète fidèlement cette exigence,
  // jamais pré-cochée, jamais envoyée implicitement.
  const pretAEnvoyer = canalHorsSysteme.trim().length > 0 && confirmeCommunique;

  async function enregistrer() {
    setErreur(null);
    setEnvoi(true);
    const r = await fetch(`/api/talent/demandes/${demandeId}/candidate-proposals/${proposition.id}/decision-hors-systeme`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reponse, canalHorsSysteme: canalHorsSysteme.trim(), communiqueParClientHorsSysteme: true }),
    });
    setEnvoi(false);
    setConfirmationVisible(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setErreur(d.error ?? "Enregistrement impossible — l'état de cette proposition a peut-être changé.");
      onDecide();
      return;
    }
    setOuvert(false);
    setCanalHorsSysteme("");
    setConfirmeCommunique(false);
    onDecide();
  }

  if (!ouvert) {
    return (
      <div style={{ marginTop: 10, borderTop: `1px solid ${bordure}`, paddingTop: 10 }}>
        <button
          onClick={() => setOuvert(true)}
          style={{ fontSize: 12, padding: "6px 12px", background: "#fff", color: grisTexte, border: `1px solid ${bordure}`, borderRadius: 6, cursor: "pointer" }}
        >
          Enregistrer une décision communiquée hors système
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${bordure}`, paddingTop: 10 }}>
      <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600 }}>Décision communiquée hors système</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <select
          aria-label="Réponse communiquée"
          value={reponse}
          onChange={(e) => setReponse(e.target.value as "ACCEPTEE" | "REFUSEE")}
          style={{ ...champStyle, width: 160 }}
        >
          <option value="ACCEPTEE">Acceptée</option>
          <option value="REFUSEE">Refusée</option>
        </select>
        <input
          list="canaux-hors-systeme"
          aria-label="Canal hors système"
          placeholder="Canal (ex. Téléphone)"
          value={canalHorsSysteme}
          onChange={(e) => setCanalHorsSysteme(e.target.value)}
          style={{ ...champStyle, width: 220 }}
        />
        <datalist id="canaux-hors-systeme">
          {CANAUX_HORS_SYSTEME_SUGGESTIONS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: grisTexte, marginBottom: 8 }}>
        <input type="checkbox" checked={confirmeCommunique} onChange={(e) => setConfirmeCommunique(e.target.checked)} style={{ marginTop: 2 }} />
        <span>Je confirme que le Client a communiqué cette décision hors système (jamais une décision prise à sa place).</span>
      </label>
      {erreur && <p style={{ color: rouge, fontSize: 12, margin: "0 0 8px" }}>{erreur}</p>}

      {!confirmationVisible && (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setConfirmationVisible(true)}
            disabled={!pretAEnvoyer}
            style={{ fontSize: 12, padding: "6px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: pretAEnvoyer ? "pointer" : "default", opacity: pretAEnvoyer ? 1 : 0.6 }}
          >
            Enregistrer la décision
          </button>
          <button
            onClick={() => setOuvert(false)}
            style={{ fontSize: 12, padding: "6px 12px", background: "#fff", color: grisTexte, border: `1px solid ${bordure}`, borderRadius: 6, cursor: "pointer" }}
          >
            Annuler
          </button>
        </div>
      )}
      {confirmationVisible && (
        <div style={{ border: `1px solid ${bleu}`, borderRadius: 6, padding: 10, background: "#eaf0fd" }}>
          <p style={{ margin: "0 0 8px", fontSize: 12 }}>
            Cette décision ({reponse === "ACCEPTEE" ? "acceptée" : "refusée"}, canal « {canalHorsSysteme} ») sera enregistrée pour le compte du
            Client. Confirmer ?
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={enregistrer}
              disabled={envoi}
              style={{ fontSize: 12, padding: "6px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
            >
              {envoi ? "Enregistrement…" : "Confirmer"}
            </button>
            <button
              onClick={() => setConfirmationVisible(false)}
              disabled={envoi}
              style={{ fontSize: 12, padding: "6px 12px", background: "#fff", color: grisTexte, border: `1px solid ${bordure}`, borderRadius: 6, cursor: "pointer" }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BoutonRetrait({ proposition, demandeId, onRetire }: { proposition: CandidateProposal; demandeId: string; onRetire: () => void }) {
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function retirer() {
    setErreur(null);
    setEnvoi(true);
    const r = await fetch(`/api/talent/demandes/${demandeId}/candidate-proposals/${proposition.id}/retirer`, { method: "PATCH" });
    setEnvoi(false);
    setConfirmationVisible(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setErreur(d.error ?? "Retrait impossible — l'état de cette proposition a peut-être changé.");
      onRetire();
      return;
    }
    onRetire();
  }

  return (
    <div style={{ marginTop: 8 }}>
      {erreur && <p style={{ color: rouge, fontSize: 12, margin: "0 0 6px" }}>{erreur}</p>}
      {!confirmationVisible ? (
        <button
          onClick={() => setConfirmationVisible(true)}
          style={{ fontSize: 11, padding: "4px 10px", background: "#fff", color: rouge, border: `1px solid ${rouge}`, borderRadius: 6, cursor: "pointer" }}
        >
          Retirer
        </button>
      ) : (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: grisTexte }}>Confirmer le retrait ?</span>
          <button
            onClick={retirer}
            disabled={envoi}
            style={{ fontSize: 11, padding: "4px 10px", background: rouge, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
          >
            {envoi ? "…" : "Confirmer"}
          </button>
          <button
            onClick={() => setConfirmationVisible(false)}
            disabled={envoi}
            style={{ fontSize: 11, padding: "4px 10px", background: "#fff", color: grisTexte, border: `1px solid ${bordure}`, borderRadius: 6, cursor: "pointer" }}
          >
            Annuler
          </button>
        </span>
      )}
    </div>
  );
}

const MODES_TRAVAIL_MISSION = ["Remote", "Hybride", "Sur site"] as const;

// A36.6 (décision A36.5) — déclenche POST /api/missions (branche
// candidateProposalId déjà existante). Jamais de champ "profilId" dans ce
// formulaire : l'ingénieur associé est résolu exclusivement côté serveur
// depuis la chaîne CandidateProposal -> CandidateFinalDecisionEntree ->
// CandidateSelection -> ShortlistEntree.profilId (lib/candidate-proposal/
// mission.ts) — jamais choisi par le navigateur. Si une Mission existe déjà
// (`proposition.missionCreee`), affiche uniquement le lien vers celle-ci,
// jamais un second formulaire de création.
function BoutonCreerMission({ proposition, onCree }: { proposition: CandidateProposal; onCree: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [nbJours, setNbJours] = useState("");
  const [tjmVente, setTjmVente] = useState("");
  const [deviseVente, setDeviseVente] = useState("EUR");
  const [repere, setRepere] = useState("");
  const [dateDebut, setDateDebut] = useState("");
  const [modeTravail, setModeTravail] = useState("");
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const champsValides = nbJours.trim().length > 0 && Number(nbJours) > 0 && tjmVente.trim().length > 0 && Number(tjmVente) > 0;

  async function creerMission() {
    setErreur(null);
    setEnvoi(true);
    const r = await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateProposalId: proposition.id,
        nbJours: Number(nbJours),
        tjmVente: Number(tjmVente),
        deviseVente,
        repere: repere.trim() || undefined,
        dateDebut: dateDebut || undefined,
        modeTravail: modeTravail || undefined,
      }),
    });
    setEnvoi(false);
    setConfirmationVisible(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setErreur(d.error ?? "Création de la Mission impossible — l'état de cette proposition a peut-être changé.");
      onCree(); // la proposition peut déjà avoir une Mission (conflit de concurrence) — jamais un état figé localement
      return;
    }
    setOuvert(false);
    onCree();
  }

  if (proposition.missionCreee) {
    return (
      <p style={{ margin: "6px 0 0", fontSize: 12, color: grisTexte }}>
        Mission déjà créée —{" "}
        <a href={`/admin/missions/${proposition.missionCreee.id}`} style={{ color: bleu }}>
          voir la Mission →
        </a>
      </p>
    );
  }

  if (!ouvert) {
    return (
      <button
        onClick={() => setOuvert(true)}
        style={{ marginTop: 8, fontSize: 12, padding: "6px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
      >
        Créer la Mission
      </button>
    );
  }

  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${bordure}`, paddingTop: 10 }}>
      <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600 }}>Créer la Mission depuis cette proposition acceptée</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={labelStyle}>Nombre de jours</label>
          <input type="number" min={1} aria-label="Nombre de jours" value={nbJours} onChange={(e) => setNbJours(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>TJM vente</label>
          <input type="number" min={1} aria-label="TJM vente" value={tjmVente} onChange={(e) => setTjmVente(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>Devise</label>
          <select aria-label="Devise de la Mission" value={deviseVente} onChange={(e) => setDeviseVente(e.target.value)} style={champStyle}>
            {CANDIDATE_PROPOSAL_DEVISES_ACCEPTEES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Repère (optionnel)</label>
          <input aria-label="Repère de la Mission" value={repere} onChange={(e) => setRepere(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>Date de début (optionnel)</label>
          <input
            type="date"
            aria-label="Date de début de la Mission"
            value={dateDebut}
            onChange={(e) => setDateDebut(e.target.value)}
            style={champStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Mode de travail (optionnel)</label>
          <select aria-label="Mode de travail" value={modeTravail} onChange={(e) => setModeTravail(e.target.value)} style={champStyle}>
            <option value="">—</option>
            {MODES_TRAVAIL_MISSION.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>
      {erreur && <p style={{ color: rouge, fontSize: 12, margin: "8px 0 0" }}>{erreur}</p>}

      {!confirmationVisible && (
        <button
          onClick={() => setConfirmationVisible(true)}
          disabled={!champsValides}
          style={{ marginTop: 10, fontSize: 12, padding: "6px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: champsValides ? "pointer" : "default", opacity: champsValides ? 1 : 0.6 }}
        >
          Créer la Mission
        </button>
      )}
      {confirmationVisible && (
        <div style={{ marginTop: 10, border: `1px solid ${bleu}`, borderRadius: 6, padding: 10, background: "#eaf0fd" }}>
          <p style={{ margin: "0 0 8px", fontSize: 12 }}>
            Le candidat associé à cette proposition acceptée sera affecté à la Mission créée. Confirmer la création ?
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={creerMission}
              disabled={envoi}
              style={{ fontSize: 12, padding: "6px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
            >
              {envoi ? "Création…" : "Confirmer la création"}
            </button>
            <button
              onClick={() => setConfirmationVisible(false)}
              disabled={envoi}
              style={{ fontSize: 12, padding: "6px 12px", background: "#fff", color: grisTexte, border: `1px solid ${bordure}`, borderRadius: 6, cursor: "pointer" }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FormulaireCreation({ demandeId, entreesEligibles, onCree }: { demandeId: string; entreesEligibles: EntreeEligible[]; onCree: () => void }) {
  const [candidateFinalDecisionEntreeId, setCandidateFinalDecisionEntreeId] = useState("");
  const [creation, setCreation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function creer() {
    if (!candidateFinalDecisionEntreeId) {
      setErreur("Choisissez une entrée retenue.");
      return;
    }
    setErreur(null);
    setCreation(true);
    const r = await fetch(`/api/talent/demandes/${demandeId}/candidate-proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateFinalDecisionEntreeId }),
    });
    setCreation(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setErreur(d.error ?? "Création impossible.");
      onCree();
      return;
    }
    setCandidateFinalDecisionEntreeId("");
    onCree();
  }

  // A36.9-FIX (course erreur/refetch, audit ATLAS) : le refetch déclenché
  // par onCree() après un échec (409 compris) peut retirer l'entrée
  // choisie de entreesEligibles (devenue inéligible entre le clic et la
  // réponse du serveur). Le message d'erreur ne doit JAMAIS dépendre de
  // ce rendu conditionnel pour rester visible — `erreur` est donc rendu
  // UNE SEULE FOIS, hors de la branche entreesEligibles.length === 0,
  // jamais perdu quel que soit l'état de cette liste après le refetch.
  // setErreur(null) au début de creer() (inchangé) continue de garantir
  // qu'aucun message obsolète ne survit à une nouvelle tentative ou à une
  // création réussie.
  return (
    <div style={{ borderTop: `1px solid ${bordure}`, paddingTop: 12 }}>
      {entreesEligibles.length === 0 ? (
        <p style={{ fontSize: 12, color: "#888" }}>Aucune entrée retenue éligible à une nouvelle proposition pour l&apos;instant.</p>
      ) : (
        <>
          <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>Créer une proposition</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              aria-label="Candidat retenu éligible"
              value={candidateFinalDecisionEntreeId}
              onChange={(e) => setCandidateFinalDecisionEntreeId(e.target.value)}
              style={{ ...champStyle, width: 260 }}
            >
              <option value="">Choisir un candidat retenu…</option>
              {entreesEligibles.map(({ entree, nomCandidat }) => (
                <option key={entree.id} value={entree.id}>
                  {nomCandidat}
                </option>
              ))}
            </select>
            <button
              onClick={creer}
              disabled={creation || !candidateFinalDecisionEntreeId}
              style={{ fontSize: 13, padding: "8px 16px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
            >
              {creation ? "Création…" : "Créer (brouillon)"}
            </button>
          </div>
        </>
      )}
      {erreur && <p style={{ color: rouge, fontSize: 13, margin: "8px 0 0" }}>{erreur}</p>}
    </div>
  );
}
