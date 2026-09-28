"use client";

import { useEffect, useState, FormEvent } from "react";
import { bleuFonce, bleu, grisTexte, bordure, vert, orange, rouge } from "@/lib/theme";
import { COMPETENCES_GROUPES } from "@/lib/competences";

// ATLAS — MISSION CLOSURE INTELLIGENCE (lot post-2B-1).
//
// RÈGLE ABSOLUE (mandat section 2) : une mission terminée n'est PAS une
// preuve de compétence. Ce panneau ne fait jamais rien d'automatique — il
// se contente de rendre visible, au bon moment, le mécanisme humain déjà
// existant (MissionSkillProposal -> validation Admin -> SkillEvidence,
// Phase 2B-1, entièrement réutilisé tel quel). Aucune route nouvelle,
// aucun modèle nouveau, aucun moteur d'intelligence touché — voir l'audit
// "MISSION CLOSURE INTELLIGENCE" pour la justification complète.
//
// SOFT GATE (Decision 3 de l'audit) : ce panneau ne bloque jamais la
// transition de la mission — "Terminer la mission" reste possible sans
// avoir créé la moindre proposition.
//
// Aucune donnée n'est persistée par ce composant lui-même : l'état "review
// faite" n'existe nulle part en base (Decision 2) — seule la présence de
// MissionSkillProposal réelles (déjà persistées par les routes existantes)
// constitue une trace. L'absence de proposition n'est jamais traitée comme
// une preuve que la review a eu lieu.

type MissionPourRevue = {
  id: string;
  profilId: string;
  repere: string | null;
  statut: string;
  client: { nom: string };
  profil?: { nom: string; prenom?: string | null };
};

type Proposition = {
  id: string;
  competence: string;
  niveauPropose: number | null;
  contexte: string | null;
  statut: "EN_ATTENTE" | "VALIDEE" | "REFUSEE";
  motifRefus: string | null;
  createdAt: string;
};

const LABEL_STATUT: Record<Proposition["statut"], string> = {
  EN_ATTENTE: "Compétence à revoir — en attente de décision",
  VALIDEE: "Validée — preuve mission existante",
  REFUSEE: "Proposition refusée",
};

const COULEUR_STATUT: Record<Proposition["statut"], string> = {
  EN_ATTENTE: orange,
  VALIDEE: vert,
  REFUSEE: rouge,
};

function nomIngenieur(p?: { nom: string; prenom?: string | null }): string {
  if (!p) return "—";
  return p.prenom ? `${p.prenom} ${p.nom}` : p.nom;
}

export default function MissionClosureReview({
  mission,
  onFermer,
  onMissionTerminee,
}: {
  mission: MissionPourRevue;
  onFermer: () => void;
  onMissionTerminee: () => void;
}) {
  const [propositions, setPropositions] = useState<Proposition[] | null>(null);
  const [erreurChargement, setErreurChargement] = useState("");

  const [competence, setCompetence] = useState("");
  const [niveauPropose, setNiveauPropose] = useState("");
  const [contexte, setContexte] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreurCreation, setErreurCreation] = useState("");

  // Section 17 du mandat : niveauPropose (saisi ci-dessus, par n'importe
  // quel auteur) et niveauObserve (saisi ICI, uniquement au moment de la
  // décision Admin) sont deux concepts distincts, jamais confondus — un
  // champ de saisie séparé par proposition, jamais pré-rempli avec
  // niveauPropose.
  const [niveauObserve, setNiveauObserve] = useState<Record<string, string>>({});
  const [decisionEnCours, setDecisionEnCours] = useState<string | null>(null);
  const [erreurDecision, setErreurDecision] = useState("");

  const [terminaison, setTerminaison] = useState(false);
  const [erreurTerminaison, setErreurTerminaison] = useState("");

  // Decision 3 du mandat : "Aucune compétence supplémentaire" est un état
  // purement local, jamais persisté (aucune requête réseau) — une simple
  // reconnaissance visuelle que l'Admin a consulté la revue et n'a rien à
  // documenter. Réinitialisé à chaque ouverture du panneau (pas de mémoire
  // au-delà de la session d'affichage courante).
  const [aucuneCompetenceConfirmee, setAucuneCompetenceConfirmee] = useState(false);

  function charger() {
    setErreurChargement("");
    fetch(`/api/missions/${mission.id}/skill-proposals`)
      .then((r) => {
        if (!r.ok) throw new Error("Échec du chargement des propositions.");
        return r.json();
      })
      .then((d) => setPropositions(d.propositions ?? []))
      .catch(() => {
        setPropositions([]);
        setErreurChargement("Impossible de charger les propositions de compétences pour cette mission.");
      });
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission.id]);

  async function proposer(e: FormEvent) {
    e.preventDefault();
    if (!competence) {
      setErreurCreation("Choisissez une compétence.");
      return;
    }
    setErreurCreation("");
    setEnvoi(true);
    const res = await fetch(`/api/missions/${mission.id}/skill-proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        competence,
        niveauPropose: niveauPropose ? Number(niveauPropose) : undefined,
        contexte: contexte.trim() || undefined,
      }),
    });
    setEnvoi(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErreurCreation(data.error ?? "Échec de la création de la proposition.");
      return;
    }
    setCompetence("");
    setNiveauPropose("");
    setContexte("");
    setAucuneCompetenceConfirmee(false);
    charger();
  }

  async function valider(propositionId: string) {
    if (!confirm("Confirmer la validation de cette proposition ? Une SkillEvidence sera créée.")) return;
    setErreurDecision("");
    setDecisionEnCours(propositionId + "valider");
    const brut = niveauObserve[propositionId];
    const valeurNiveauObserve = brut && brut.trim() !== "" ? Number(brut) : undefined;
    const res = await fetch(`/api/profils/${mission.profilId}/skill-proposals/${propositionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "valider", niveauObserve: valeurNiveauObserve }),
    });
    setDecisionEnCours(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErreurDecision(data.error ?? "Échec de la validation.");
      return;
    }
    charger();
  }

  async function refuser(propositionId: string) {
    const motif = prompt("Motif du refus (optionnel) :") ?? undefined;
    setErreurDecision("");
    setDecisionEnCours(propositionId + "refuser");
    const res = await fetch(`/api/profils/${mission.profilId}/skill-proposals/${propositionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refuser", motif: motif || undefined }),
    });
    setDecisionEnCours(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErreurDecision(data.error ?? "Échec du refus.");
      return;
    }
    charger();
  }

  async function terminerLaMission() {
    if (!confirm("Confirmer : terminer cette mission ? Cette action est définitive.")) return;
    setErreurTerminaison("");
    setTerminaison(true);
    const res = await fetch(`/api/missions/${mission.id}/transition`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "terminer" }),
    });
    setTerminaison(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErreurTerminaison(data.error ?? "Échec de la transition de la mission.");
      return;
    }
    // Le panneau reste ouvert (mandat section 9.D) — seule la liste des
    // missions est rechargée par le parent, ce qui met à jour m.statut et
    // fait donc disparaître le bouton "Terminer la mission" au prochain
    // rendu (mission déjà Terminée).
    onMissionTerminee();
  }

  const propositionsEnAttente = propositions?.filter((p) => p.statut === "EN_ATTENTE") ?? [];
  const autresPropositions = propositions?.filter((p) => p.statut !== "EN_ATTENTE") ?? [];

  return (
    <div style={{ border: `1px solid ${bordure}`, borderTop: "none", padding: 16, background: "#fafbfc" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: bleuFonce }}>Revue de clôture</p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: grisTexte }}>
            Mission {mission.repere ?? mission.id} · {mission.client.nom} · {nomIngenieur(mission.profil)} · statut actuel : {mission.statut}
          </p>
        </div>
        <button onClick={onFermer} style={{ fontSize: 12, padding: "2px 8px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}>
          Fermer
        </button>
      </div>

      <p style={{ fontSize: 12, color: grisTexte, marginBottom: 12, maxWidth: 640 }}>
        Une mission ne prouve jamais automatiquement qu&apos;une compétence a été mobilisée. Les éléments ci-dessous
        sont des suggestions de revue — chacun nécessite une décision humaine avant de devenir une preuve.
      </p>

      {erreurChargement && <p style={{ fontSize: 12, color: rouge, marginBottom: 10 }}>{erreurChargement}</p>}

      {propositions === null ? (
        <p style={{ fontSize: 12, color: "#888" }}>Chargement...</p>
      ) : propositions.length === 0 ? (
        <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
          Aucune compétence à revoir pour l&apos;instant sur cette mission.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {[...propositionsEnAttente, ...autresPropositions].map((p) => (
            <div
              key={p.id}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 12, border: "1px solid #eee", borderRadius: 6, padding: 8, background: "#fff" }}
            >
              <div>
                <strong>{p.competence}</strong>
                {p.niveauPropose != null && <span> — niveau proposé : {p.niveauPropose}</span>}
                {p.contexte && <div style={{ color: "#666", marginTop: 2 }}>{p.contexte}</div>}
                {p.statut === "REFUSEE" && p.motifRefus && <div style={{ color: rouge, marginTop: 2 }}>Motif : {p.motifRefus}</div>}

                {p.statut === "EN_ATTENTE" && (
                  <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <label style={{ fontSize: 11, color: grisTexte, display: "flex", alignItems: "center", gap: 4 }}>
                      Niveau observé (Admin) :
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={niveauObserve[p.id] ?? ""}
                        onChange={(e) => setNiveauObserve((v) => ({ ...v, [p.id]: e.target.value }))}
                        style={{ width: 44, padding: 2 }}
                      />
                    </label>
                    <button
                      onClick={() => valider(p.id)}
                      disabled={decisionEnCours === p.id + "valider"}
                      style={{ fontSize: 11, padding: "3px 8px", border: `1px solid ${vert}`, color: vert, background: "#fff", cursor: "pointer" }}
                    >
                      Valider
                    </button>
                    <button
                      onClick={() => refuser(p.id)}
                      disabled={decisionEnCours === p.id + "refuser"}
                      style={{ fontSize: 11, padding: "3px 8px", border: `1px solid ${rouge}`, color: rouge, background: "#fff", cursor: "pointer" }}
                    >
                      Refuser
                    </button>
                  </div>
                )}
              </div>
              <span style={{ color: COULEUR_STATUT[p.statut], fontWeight: 600, whiteSpace: "nowrap", textAlign: "right", maxWidth: 180 }}>
                {LABEL_STATUT[p.statut]}
              </span>
            </div>
          ))}
        </div>
      )}
      {erreurDecision && <p style={{ fontSize: 12, color: rouge, marginBottom: 10 }}>{erreurDecision}</p>}

      <form onSubmit={proposer} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
        <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          Compétence à proposer
          <select value={competence} onChange={(e) => setCompetence(e.target.value)} style={{ padding: 6, minWidth: 180 }}>
            <option value="">Choisir...</option>
            {COMPETENCES_GROUPES.map((groupe) => (
              <optgroup key={groupe.categorie} label={groupe.categorie}>
                {groupe.competences.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          Niveau proposé (optionnel)
          <input type="number" min={1} max={5} value={niveauPropose} onChange={(e) => setNiveauPropose(e.target.value)} style={{ padding: 6, width: 70 }} />
        </label>
        <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
          Contexte (optionnel)
          <input value={contexte} onChange={(e) => setContexte(e.target.value)} style={{ padding: 6 }} placeholder="Technologie, rôle, environnement..." />
        </label>
        <button type="submit" disabled={envoi} style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, border: `1px solid ${bleu}`, color: bleu, background: "#fff", cursor: "pointer" }}>
          {envoi ? "Envoi..." : "+ Ajouter une proposition"}
        </button>
      </form>
      {erreurCreation && <p style={{ fontSize: 12, color: rouge, marginBottom: 10 }}>{erreurCreation}</p>}

      <div style={{ borderTop: `1px solid ${bordure}`, paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <button
            onClick={() => setAucuneCompetenceConfirmee(true)}
            style={{ fontSize: 12, padding: "6px 12px", border: `1px solid ${bordure}`, background: "#fff", cursor: "pointer" }}
          >
            Aucune compétence supplémentaire
          </button>
          {aucuneCompetenceConfirmee && (
            <p style={{ fontSize: 11, color: grisTexte, margin: "6px 0 0" }}>
              Confirmé : aucune compétence supplémentaire à documenter pour l&apos;instant sur cette mission.
            </p>
          )}
        </div>

        {mission.statut === "En cours" && (
          <div style={{ textAlign: "right" }}>
            <button
              onClick={terminerLaMission}
              disabled={terminaison}
              style={{ fontSize: 12, padding: "7px 14px", fontWeight: 600, border: `1px solid ${bleuFonce}`, color: "#fff", background: bleuFonce, cursor: "pointer" }}
            >
              {terminaison ? "Terminaison..." : "Terminer la mission"}
            </button>
            {erreurTerminaison && <p style={{ fontSize: 11, color: rouge, margin: "6px 0 0" }}>{erreurTerminaison}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
