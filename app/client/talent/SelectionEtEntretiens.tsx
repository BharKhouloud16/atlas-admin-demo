"use client";

import { useEffect, useState } from "react";
import { bordure, grisTexte } from "@/lib/theme";
import { Card, EmptyState, Badge, Bouton } from "@/components/client/primitives";

// ATLAS CANDIDATE DECISION + INTERVIEW (11/10/2026) — voir
// docs/architecture/CANDIDATE_DECISION_INTERVIEW_IMPLEMENTATION_CONTRACT.md
// §16. Réutilise exclusivement components/client/primitives.tsx
// (Card/EmptyState/Badge/Bouton) — aucun nouveau token, aucun Modal/Dialog
// introduit, esthétique alignée sur CandidatCard/RevueBesoin (fichier
// voisin app/client/talent/page.tsx). Formulaires courts, traçabilité
// affichée telle quelle (daté/attribué, jamais modifiable après coup).

// CORRECTIF P0 (audit §12.3) — `score`/`confiance` retirés : CTO Validation
// §5 interdit explicitement leur sérialisation vers le Client. `explications`
// (texte qualitatif, jamais un chiffre) remplace l'ancien champ `motifs`.
type ShortlistCandidat = {
  shortlistEntreeId: string;
  ingenieurId: string;
  seniorite: string | null;
  anneesExperience: number | null;
  disponibilite: string | null;
  localisation: string | null;
  explications: { critere: string; detail: string }[];
  dejaSelectionne: boolean;
};

type CandidateSelection = {
  id: string;
  statut: "ACTIVE" | "RETIREE";
  shortlistEntreeId: string;
  selectedAt: string;
};

type InterviewParticipant = {
  id: string;
  role: string;
  fonctionDeclaree: string | null;
  estOrganisateur: boolean;
  statutInvitation: string;
};

type Interview = {
  id: string;
  statut: string;
  canal: string;
  dateHeure: string;
  dureeMinutes: number;
  lieu: string | null;
  meetingUrl: string | null;
  participants: InterviewParticipant[];
};

const LABEL_STATUT_SELECTION: Record<string, string> = { ACTIVE: "Active", RETIREE: "Retirée" };
const LABEL_STATUT_INTERVIEW: Record<string, string> = {
  PLANIFIE: "Planifié",
  CONFIRME: "Confirmé",
  TERMINE: "Terminé",
  ANNULE: "Annulé",
  ABSENT: "Absent",
};

export default function SelectionEtEntretiens({ demandeId }: { demandeId: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [shortlist, setShortlist] = useState<ShortlistCandidat[] | null>(null);
  const [selections, setSelections] = useState<CandidateSelection[] | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function charger() {
    setChargement(true);
    setErreur(null);
    const [reponseShortlist, reponseSelections] = await Promise.all([
      fetch(`/api/client/talent-selection/demandes/${demandeId}/shortlist`),
      fetch(`/api/client/talent-selection/demandes/${demandeId}/selections`),
    ]);
    setChargement(false);
    if (!reponseShortlist.ok || !reponseSelections.ok) {
      setErreur("Impossible de charger la sélection et les entretiens.");
      return;
    }
    const dataShortlist = await reponseShortlist.json();
    const dataSelections = await reponseSelections.json();
    setShortlist(dataShortlist.resultats ?? []);
    setSelections(dataSelections.selections ?? []);
  }

  useEffect(() => {
    if (ouvert) charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);

  async function selectionner(shortlistEntreeId: string) {
    setErreur(null);
    const reponse = await fetch(`/api/client/talent-selection/demandes/${demandeId}/selections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shortlistEntreeId }),
    });
    if (!reponse.ok) {
      const d = await reponse.json().catch(() => ({}));
      setErreur(d.error ?? "Sélection impossible.");
      return;
    }
    await charger();
  }

  async function retirer(selectionId: string) {
    setErreur(null);
    const reponse = await fetch(`/api/client/talent-selection/selections/${selectionId}`, { method: "DELETE" });
    if (!reponse.ok) {
      const d = await reponse.json().catch(() => ({}));
      setErreur(d.error ?? "Retrait impossible.");
      return;
    }
    await charger();
  }

  if (!ouvert) {
    return (
      <Bouton variant="secondary" onClick={() => setOuvert(true)}>
        Sélection & entretiens
      </Bouton>
    );
  }

  return (
    <div style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Sélection & entretiens</p>
        <Bouton variant="secondary" onClick={() => setOuvert(false)}>
          Fermer
        </Bouton>
      </div>

      {erreur && <p style={{ color: "#c0392b", fontSize: 13, margin: "0 0 8px" }}>{erreur}</p>}
      {chargement && <EmptyState message="Chargement…" />}

      {!chargement && shortlist && (
        <>
          <p style={{ fontSize: 12, fontWeight: 600, margin: "8px 0 4px" }}>Candidats proposés (shortlist validée)</p>
          {shortlist.length === 0 && <EmptyState message="Aucun candidat validé pour l'instant." />}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {shortlist.map((c) => (
              <Card key={c.shortlistEntreeId}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 600 }}>{c.ingenieurId}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: grisTexte }}>
                      {c.seniorite ?? "Séniorité non renseignée"}
                      {c.anneesExperience != null ? ` · ${c.anneesExperience} an(s)` : ""}
                      {c.disponibilite ? ` · ${c.disponibilite}` : ""}
                      {c.localisation ? ` · ${c.localisation}` : ""}
                    </p>
                  </div>
                  {c.dejaSelectionne ? (
                    <Badge variant="info">Déjà sélectionné</Badge>
                  ) : (
                    <Bouton onClick={() => selectionner(c.shortlistEntreeId)}>Sélectionner</Bouton>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {!chargement && selections && selections.length > 0 && (
        <>
          <p style={{ fontSize: 12, fontWeight: 600, margin: "14px 0 4px" }}>Candidats sélectionnés</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {selections.map((s) => (
              <SelectionDetail key={s.id} selection={s} onRetirer={() => retirer(s.id)} />
            ))}
          </div>

          <ComparaisonEtDecision demandeId={demandeId} selectionsActives={selections.filter((s) => s.statut === "ACTIVE")} />
        </>
      )}
    </div>
  );
}

// CORRECTIF P0 (audit §12.3) — `matching: {score, confiance}` retiré : CTO
// Validation §5 interdit explicitement la sérialisation de ces champs vers
// le Client. `explications` (texte qualitatif) les remplace.
type CandidatComparaison = {
  selectionId: string;
  statut: string;
  ingenieurId: string;
  seniorite: string | null;
  disponibilite: string | null;
  explications: { critere: string; detail: string }[];
  evaluations: { evaluateurRole: string; recommandation: string; commentairesLibres: string | null }[];
  nombreEntretiens: number;
};

type DecisionEntree = { candidateSelectionId: string; statut: "RETENU" | "NON_RETENU"; justification?: string };

const LABEL_RECOMMANDATION: Record<string, string> = {
  RECOMMANDE: "Recommandé",
  RECOMMANDE_AVEC_RESERVES: "Recommandé (réserves)",
  NON_RECOMMANDE: "Non recommandé",
};

// §12 Design Contract — vue de lecture pure, jamais un "meilleur candidat"
// généré automatiquement : les faits sont présentés côte à côte, la
// décision reste un choix humain explicite ci-dessous (§7, exclusivement
// Client).
function ComparaisonEtDecision({ demandeId, selectionsActives }: { demandeId: string; selectionsActives: CandidateSelection[] }) {
  const [candidats, setCandidats] = useState<CandidatComparaison[] | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "RETENU" | "NON_RETENU" | "">>({});
  const [justifications, setJustifications] = useState<Record<string, string>>({});
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  async function charger() {
    const reponse = await fetch(`/api/client/talent-selection/demandes/${demandeId}/comparison`);
    if (reponse.ok) {
      const d = await reponse.json();
      setCandidats(d.candidats ?? []);
    }
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function envoyerDecision() {
    const entrees: DecisionEntree[] = selectionsActives
      .map((s): DecisionEntree | null => {
        const statut = decisions[s.id];
        if (!statut) return null;
        if (statut === "NON_RETENU" && !justifications[s.id]?.trim()) return null;
        return { candidateSelectionId: s.id, statut, justification: justifications[s.id] || undefined };
      })
      .filter((e): e is DecisionEntree => e !== null);

    if (entrees.length === 0) {
      setErreur("Choisissez un statut pour au moins un candidat (justification requise si « Non retenu »).");
      return;
    }

    setErreur(null);
    setEnvoi(true);
    const reponse = await fetch(`/api/client/talent-selection/demandes/${demandeId}/final-decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entrees }),
    });
    setEnvoi(false);
    if (!reponse.ok) {
      const d = await reponse.json().catch(() => ({}));
      setErreur(d.error ?? "Décision impossible.");
      return;
    }
    setConfirmation("Décision enregistrée.");
  }

  if (!candidats || candidats.length === 0) return null;

  return (
    <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${bordure}` }}>
      <p style={{ fontSize: 12, fontWeight: 600, margin: "0 0 6px" }}>Comparaison & décision finale</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {candidats.map((c) => (
          <Card key={c.selectionId}>
            <p style={{ margin: 0, fontWeight: 600 }}>{c.ingenieurId}</p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: grisTexte }}>
              {c.seniorite ?? "Séniorité non renseignée"}
              {c.disponibilite ? ` · ${c.disponibilite}` : ""} · {c.nombreEntretiens} entretien(s)
            </p>
            {c.explications.length > 0 && (
              <p style={{ margin: "4px 0 0", fontSize: 12 }}>
                {c.explications.map((e) => e.detail).join(" · ")}
              </p>
            )}
            {c.evaluations.map((e, i) => (
              <p key={i} style={{ margin: "4px 0 0", fontSize: 12 }}>
                {LABEL_RECOMMANDATION[e.recommandation] ?? e.recommandation}
                {e.commentairesLibres ? ` — ${e.commentairesLibres}` : ""}
              </p>
            ))}
            {c.statut === "ACTIVE" && (
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                <select
                  value={decisions[c.selectionId] ?? ""}
                  onChange={(e) => setDecisions({ ...decisions, [c.selectionId]: e.target.value as "RETENU" | "NON_RETENU" | "" })}
                  style={{ padding: 6, border: `1px solid ${bordure}`, borderRadius: 6 }}
                >
                  <option value="">— Décision —</option>
                  <option value="RETENU">Retenu</option>
                  <option value="NON_RETENU">Non retenu</option>
                </select>
                {decisions[c.selectionId] === "NON_RETENU" && (
                  <input
                    placeholder="Justification (requise)"
                    value={justifications[c.selectionId] ?? ""}
                    onChange={(e) => setJustifications({ ...justifications, [c.selectionId]: e.target.value })}
                    style={{ padding: 6, border: `1px solid ${bordure}`, borderRadius: 6, flex: 1, minWidth: 200 }}
                  />
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
      {erreur && <p style={{ color: "#c0392b", fontSize: 12, margin: "8px 0 0" }}>{erreur}</p>}
      {confirmation && <p style={{ color: "#2e7d32", fontSize: 12, margin: "8px 0 0" }}>{confirmation}</p>}
      <div style={{ marginTop: 8 }}>
        <Bouton onClick={envoyerDecision} disabled={envoi}>
          {envoi ? "Envoi…" : "Enregistrer la décision finale"}
        </Bouton>
      </div>
    </div>
  );
}

function SelectionDetail({ selection, onRetirer }: { selection: CandidateSelection; onRetirer: () => void }) {
  const [identite, setIdentite] = useState<{ nom: string; prenom: string } | null>(null);
  const [interviews, setInterviews] = useState<Interview[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function reveler() {
    setErreur(null);
    const reponse = await fetch(`/api/client/talent-selection/selections/${selection.id}/profil`);
    if (!reponse.ok) {
      setErreur("Identité indisponible.");
      return;
    }
    setIdentite(await reponse.json());
  }

  async function chargerInterviews() {
    const reponse = await fetch(`/api/client/talent-selection/selections/${selection.id}/interviews`);
    if (reponse.ok) {
      const d = await reponse.json();
      setInterviews(d.interviews ?? []);
    }
  }

  useEffect(() => {
    chargerInterviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600 }}>
            {identite ? `${identite.prenom} ${identite.nom}` : "Candidat sélectionné"}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: grisTexte }}>
            Sélectionné le {new Date(selection.selectedAt).toLocaleDateString("fr-FR")}
          </p>
        </div>
        <Badge variant={selection.statut === "ACTIVE" ? "success" : "neutral"}>{LABEL_STATUT_SELECTION[selection.statut]}</Badge>
      </div>
      {erreur && <p style={{ color: "#c0392b", fontSize: 12, margin: "6px 0 0" }}>{erreur}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {!identite && (
          <Bouton variant="secondary" onClick={reveler}>
            Voir l'identité
          </Bouton>
        )}
        {selection.statut === "ACTIVE" && (
          <Bouton variant="secondary" onClick={onRetirer}>
            Retirer de la sélection
          </Bouton>
        )}
      </div>

      {interviews && interviews.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${bordure}` }}>
          <p style={{ fontSize: 12, fontWeight: 600, margin: "0 0 6px" }}>Entretiens</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {interviews.map((i) => (
              <InterviewDetail key={i.id} interview={i} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function InterviewDetail({ interview }: { interview: Interview }) {
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  return (
    <div style={{ border: `1px solid ${bordure}`, borderRadius: 6, padding: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ margin: 0, fontSize: 12 }}>
          {new Date(interview.dateHeure).toLocaleString("fr-FR")} · {interview.canal} · {interview.dureeMinutes} min
        </p>
        <Badge variant="info">{LABEL_STATUT_INTERVIEW[interview.statut] ?? interview.statut}</Badge>
      </div>
      {interview.lieu && <p style={{ margin: "4px 0 0", fontSize: 12, color: grisTexte }}>Lieu : {interview.lieu}</p>}
      {interview.meetingUrl && (
        <p style={{ margin: "4px 0 0", fontSize: 12 }}>
          <a href={interview.meetingUrl} target="_blank" rel="noreferrer">
            Rejoindre l'entretien
          </a>
        </p>
      )}
      <div style={{ marginTop: 6 }}>
        <Bouton variant="secondary" onClick={() => setFormulaireOuvert((v) => !v)}>
          {formulaireOuvert ? "Fermer l'évaluation" : "Évaluer cet entretien"}
        </Bouton>
      </div>
      {formulaireOuvert && <FormulaireEvaluation interviewId={interview.id} onEnvoye={() => setFormulaireOuvert(false)} />}
    </div>
  );
}

const CRITERES_DISPONIBLES = ["Compétences", "Séniorité", "Communication", "Motivation"];
const RECOMMANDATIONS = [
  { valeur: "RECOMMANDE", label: "Recommandé" },
  { valeur: "RECOMMANDE_AVEC_RESERVES", label: "Recommandé avec réserves" },
  { valeur: "NON_RECOMMANDE", label: "Non recommandé" },
];

// §1.4 — formulaire court (critères fermés + texte libre + recommandation
// qualitative), jamais modifiable après envoi (append-only côté serveur).
function FormulaireEvaluation({ interviewId, onEnvoye }: { interviewId: string; onEnvoye: () => void }) {
  const [critere, setCritere] = useState(CRITERES_DISPONIBLES[0]);
  const [appreciation, setAppreciation] = useState<"POSITIF" | "NEUTRE" | "NEGATIF">("POSITIF");
  const [observation, setObservation] = useState("");
  const [recommandation, setRecommandation] = useState(RECOMMANDATIONS[0].valeur);
  const [commentairesLibres, setCommentairesLibres] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer() {
    if (observation.trim().length === 0) {
      setErreur("Merci de renseigner une observation.");
      return;
    }
    setErreur(null);
    setEnvoi(true);
    const reponse = await fetch(`/api/client/talent-selection/interviews/${interviewId}/evaluations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        criteres: [{ critere, observation, appreciation }],
        recommandation,
        commentairesLibres: commentairesLibres || undefined,
      }),
    });
    setEnvoi(false);
    if (!reponse.ok) {
      const d = await reponse.json().catch(() => ({}));
      setErreur(d.error ?? "Envoi impossible.");
      return;
    }
    onEnvoye();
  }

  return (
    <div style={{ marginTop: 8, borderTop: `1px solid ${bordure}`, paddingTop: 8 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <select value={critere} onChange={(e) => setCritere(e.target.value)} style={{ padding: 6, border: `1px solid ${bordure}`, borderRadius: 6 }}>
          {CRITERES_DISPONIBLES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={appreciation}
          onChange={(e) => setAppreciation(e.target.value as "POSITIF" | "NEUTRE" | "NEGATIF")}
          style={{ padding: 6, border: `1px solid ${bordure}`, borderRadius: 6 }}
        >
          <option value="POSITIF">Positif</option>
          <option value="NEUTRE">Neutre</option>
          <option value="NEGATIF">Négatif</option>
        </select>
      </div>
      <textarea
        placeholder="Observation sur ce critère"
        value={observation}
        onChange={(e) => setObservation(e.target.value)}
        rows={2}
        style={{ width: "100%", padding: 8, fontFamily: "inherit", marginBottom: 6, border: `1px solid ${bordure}`, borderRadius: 6 }}
      />
      <select
        value={recommandation}
        onChange={(e) => setRecommandation(e.target.value)}
        style={{ padding: 6, border: `1px solid ${bordure}`, borderRadius: 6, marginBottom: 6, display: "block" }}
      >
        {RECOMMANDATIONS.map((r) => (
          <option key={r.valeur} value={r.valeur}>
            {r.label}
          </option>
        ))}
      </select>
      <textarea
        placeholder="Commentaires libres (facultatif)"
        value={commentairesLibres}
        onChange={(e) => setCommentairesLibres(e.target.value)}
        rows={2}
        style={{ width: "100%", padding: 8, fontFamily: "inherit", marginBottom: 6, border: `1px solid ${bordure}`, borderRadius: 6 }}
      />
      {erreur && <p style={{ color: "#c0392b", fontSize: 12, margin: "0 0 6px" }}>{erreur}</p>}
      <Bouton onClick={envoyer} disabled={envoi}>
        {envoi ? "Envoi…" : "Envoyer l'évaluation"}
      </Bouton>
    </div>
  );
}
