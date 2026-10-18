"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { bleu, bordure, grisTexte, vert, orange, rouge } from "@/lib/theme";

// COMPANY ATLAS — DB-05 : Decision Context UI (08/10/2026).
//
// Rend visible, dans l'écran de revue de Solution déjà existant (ci-
// dessous), la connaissance DÉJÀ consultée par ATLAS via A36 — consomme
// STRICTEMENT GET /api/talent/besoins/[id]/solutions (enrichi par ce
// même lot, voir route.ts) : aucun nouveau calcul de pertinence, aucun
// score, aucun classement frontend, aucun arbitrage de conflit. L'ordre
// reçu du backend (DIRECT avant CONTEXTUAL, A36.1) est conservé tel quel.

type DecisionLearningVue = {
  learningId: string;
  relevance: "DIRECT" | "CONTEXTUAL";
  scope: string;
  type: string;
  provenance: string;
  confidence: string;
  title: string;
  statement: string;
  missionId: string;
  applicability: string;
  source: { sourceType: string; sourceId: string } | null;
  reason: string;
};

type DecisionConflictVue = { learningAId: string; learningBId: string; type: string };

type DecisionContextVue = {
  subjectId: string;
  subjectNiveau: "RECOMMANDATION" | "DECISION";
  status: "RELEVANT_CONTEXT" | "NO_RELEVANT_LEARNING" | "CONFLICTING_CONTEXT";
  learnings: DecisionLearningVue[];
  conflicts: DecisionConflictVue[];
} | null;

type SolutionLigneVue = {
  id: string;
  niveau: "OPTION" | "RECOMMANDATION" | "DECISION";
  titre: string;
  justification: string;
  niveauConfiance: string;
  decideParEmail: string | null;
  decideLe: string | null;
  createdAt: string;
};

type ReponseSolutionsAdmin = {
  options: SolutionLigneVue[];
  recommandations: SolutionLigneVue[];
  decisions: SolutionLigneVue[];
  decisionContext: DecisionContextVue;
};

const COULEUR_RELEVANCE: Record<string, string> = { DIRECT: vert, CONTEXTUAL: bleu };
const COULEUR_CONFIDENCE: Record<string, string> = { LOW: grisTexte, MEDIUM: orange, HIGH: bleu };
const COULEUR_PROVENANCE_LEARNING: Record<string, string> = { OBSERVED: grisTexte, DECLARED: bleu, VERIFIED: vert, INFERRED: orange };

function PetitBadge({ valeur, couleur }: { valeur: string; couleur: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur, whiteSpace: "nowrap" }}>
      {valeur}
    </span>
  );
}

// Lien vers la page Learning DB-04 déjà existante — jamais une seconde
// page Learning (contrat DB-05 §12).
function LienLearning({ learning }: { learning: DecisionLearningVue }) {
  return (
    <Link href={`/admin/missions/${learning.missionId}/learning/${learning.learningId}`} style={{ fontSize: 11, color: bleu }}>
      Voir le Learning →
    </Link>
  );
}

function PanneauConnaissancesConsultees({ decisionContext }: { decisionContext: DecisionContextVue }) {
  if (!decisionContext) return null;
  const { learnings, conflicts } = decisionContext;

  // Résolution de titre par id, à partir des données DÉJÀ reçues — jamais
  // une seconde requête (même discipline que la supersession Learning,
  // DB-04).
  const titreParId = new Map(learnings.map((l) => [l.learningId, l.title]));

  return (
    <section style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 15 }}>Connaissances consultées par ATLAS</h2>
      <p style={{ fontSize: 12, color: grisTexte, margin: "0 0 10px" }}>
        {decisionContext.subjectNiveau === "DECISION"
          ? "Pour la décision Solution prise sur ce besoin."
          : "Pour la recommandation Solution actuelle de ce besoin."}{" "}
        Connaissances déjà validées (statut VALIDE) et actives (applicabilité ACTIVE) — jamais une proposition, jamais une connaissance obsolète.
      </p>

      {learnings.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>Aucune connaissance pertinente disponible.</p>}

      {learnings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: conflicts.length > 0 ? 12 : 0 }}>
          {learnings.map((l) => (
            <div key={l.learningId} style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{l.title}</p>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <PetitBadge valeur={l.relevance} couleur={COULEUR_RELEVANCE[l.relevance] ?? grisTexte} />
                  <PetitBadge valeur={l.confidence} couleur={COULEUR_CONFIDENCE[l.confidence] ?? grisTexte} />
                  <PetitBadge valeur={l.provenance} couleur={COULEUR_PROVENANCE_LEARNING[l.provenance] ?? grisTexte} />
                </div>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: grisTexte }}>{l.statement}</p>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "#888" }}>
                Scope {l.scope} · {l.reason}
              </p>
              <div style={{ marginTop: 6 }}>
                <LienLearning learning={l} />
              </div>
            </div>
          ))}
        </div>
      )}

      {conflicts.length > 0 && (
        <div style={{ border: `1px solid ${orange}`, borderRadius: 8, padding: 10, background: "#fff8f0" }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: orange }}>⚠ Conflit de connaissances détecté</p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: grisTexte }}>
            ATLAS a identifié une tension entre des connaissances pertinentes — aucune n&apos;est écartée, aucun gagnant n&apos;est choisi ici.
          </p>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            {conflicts.map((c, i) => (
              <p key={i} style={{ margin: 0, fontSize: 12 }}>
                {titreParId.get(c.learningAId) ?? c.learningAId} ↔ {titreParId.get(c.learningBId) ?? c.learningBId}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SectionSolutions({ besoinId, besoinStatut }: { besoinId: string; besoinStatut: string }) {
  const [donnees, setDonnees] = useState<ReponseSolutionsAdmin | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (besoinStatut !== "VALIDE") {
      setChargement(false);
      return;
    }
    fetch(`/api/talent/besoins/${besoinId}/solutions`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Erreur ${r.status}`);
        return r.json();
      })
      .then((d: ReponseSolutionsAdmin) => {
        setDonnees(d);
        setErreur(null);
      })
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }, [besoinId, besoinStatut]);

  if (besoinStatut !== "VALIDE") return null;
  if (chargement) return <p style={{ color: "#888", fontSize: 13 }}>Chargement des solutions…</p>;
  if (erreur) return <p style={{ color: rouge, fontSize: 13 }}>{erreur}</p>;
  if (!donnees) return null;

  const { options, recommandations, decisions, decisionContext } = donnees;
  const derniereRecommandation = recommandations[recommandations.length - 1] ?? null;
  const alternatives = derniereRecommandation ? options.filter((o) => o.id !== derniereRecommandation.id) : options;

  if (options.length === 0 && recommandations.length === 0 && decisions.length === 0) {
    return (
      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15 }}>Solutions</h2>
        <p style={{ fontSize: 13, color: "#888" }}>Aucune solution générée pour ce besoin pour l&apos;instant.</p>
      </section>
    );
  }

  return (
    <>
      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15 }}>Solutions</h2>

        {decisions.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 6px" }}>Décisions du client</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {decisions.map((d) => (
                <div key={d.id} style={{ border: `1px solid ${vert}`, borderRadius: 8, padding: 10, background: "#f2faf5" }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{d.titre}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: grisTexte }}>
                    Décidé le {d.decideLe ? new Date(d.decideLe).toLocaleDateString("fr-FR") : "—"} par {d.decideParEmail ?? "—"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {derniereRecommandation && (
          <div style={{ marginBottom: 10 }}>
            <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 6px" }}>Recommandation ATLAS actuelle</p>
            <div style={{ border: `1px solid ${bleu}`, borderRadius: 8, padding: 10, background: "#f8fafd" }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{derniereRecommandation.titre}</p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: grisTexte }}>{derniereRecommandation.justification}</p>
            </div>
          </div>
        )}

        {alternatives.length > 0 && (
          <div>
            <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 6px" }}>Options</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {alternatives.map((o) => (
                <p key={o.id} style={{ margin: 0, fontSize: 12, color: grisTexte }}>
                  {o.titre}
                </p>
              ))}
            </div>
          </div>
        )}
      </section>

      <PanneauConnaissancesConsultees decisionContext={decisionContext} />
    </>
  );
}

type Fait = { cle: string; valeur: string; statut: string };

type ChampSuggere<T> = { valeur: T; statut: string } | null;

type Suggestion = {
  titreSuggere: ChampSuggere<string>;
  competencesExtraites: { valeur: string; statut: string }[];
  senioriteSouhaitee: ChampSuggere<string>;
  anneesExperienceMin: ChampSuggere<number>;
  localisation: ChampSuggere<string>;
  disponibiliteSouhaitee: ChampSuggere<string>;
  budgetTjmMax: ChampSuggere<number>;
  budgetDevise: ChampSuggere<string>;
  dateDebutSouhaitee: ChampSuggere<string>;
  remoteDeclare: ChampSuggere<string>;
};

type DetailBesoin = {
  besoin: { id: string; titre: string | null; texteOriginal: string; statut: string; coherenceStatut: string; faits: Fait[] };
  client: { id: string; nom: string; secteur: string | null; pays: string | null };
  profilFaitsActifs: Fait[];
  eligibilite: { eligible: boolean; raison: string | null };
  suggestion: Suggestion;
  demandeTalentCreee: { id: string } | null;
};

const LABEL_PROVENANCE: Record<string, string> = {
  VERIFIE: "Vérifié",
  DECLARE: "Déclaré par le client",
  INFERE: "Déduit — à vérifier",
  INCONNU: "Inconnu",
};

const COULEUR_PROVENANCE: Record<string, string> = {
  VERIFIE: vert,
  DECLARE: bleu,
  INFERE: orange,
  INCONNU: grisTexte,
};

function BadgeProvenance({ statut }: { statut: string }) {
  const couleur = COULEUR_PROVENANCE[statut] ?? grisTexte;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur, whiteSpace: "nowrap" }}>
      {LABEL_PROVENANCE[statut] ?? statut}
    </span>
  );
}

const champStyle = { width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${bordure}`, fontSize: 13 };
const labelStyle = { fontSize: 12, fontWeight: 600, color: grisTexte, display: "block", marginBottom: 4 };

// COMPANY ATLAS — LOT 5 : Client Intelligence → Talent Bridge (15/09/2026).
//
// Écran central du pont : le besoin (LOT 2/3) et le profil (LOT 4) du
// client sous les yeux, une suggestion de critères pré-remplie mais
// ENTIÈREMENT éditable (chaque champ garde sa provenance visible), et une
// décision explicite en deux temps (bouton -> confirmation textuelle ->
// création) avant tout appel à POST .../creer-demande. Aucune IA n'est
// appelée depuis cet écran.
export default function BesoinTalentAdminDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [detail, setDetail] = useState<DetailBesoin | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [creationEnCours, setCreationEnCours] = useState(false);

  const [titre, setTitre] = useState("");
  const [description, setDescription] = useState("");
  const [competences, setCompetences] = useState("");
  const [seniorite, setSeniorite] = useState("");
  const [anneesExperience, setAnneesExperience] = useState("");
  const [localisation, setLocalisation] = useState("");
  const [mobilite, setMobilite] = useState("");
  const [disponibilite, setDisponibilite] = useState("");
  const [budgetTjmMax, setBudgetTjmMax] = useState("");
  const [budgetDevise, setBudgetDevise] = useState("EUR");

  useEffect(() => {
    fetch(`/api/talent/besoins/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Erreur de chargement");
        return r.json();
      })
      .then((d: DetailBesoin) => {
        setDetail(d);
        setTitre(d.suggestion.titreSuggere?.valeur ?? "");
        setDescription(d.besoin.texteOriginal);
        setCompetences(d.suggestion.competencesExtraites.map((c) => c.valeur).join(", "));
        setSeniorite(d.suggestion.senioriteSouhaitee?.valeur ?? "");
        setAnneesExperience(d.suggestion.anneesExperienceMin ? String(d.suggestion.anneesExperienceMin.valeur) : "");
        setLocalisation(d.suggestion.localisation?.valeur ?? "");
        setDisponibilite(d.suggestion.disponibiliteSouhaitee?.valeur ?? "");
        setBudgetTjmMax(d.suggestion.budgetTjmMax ? String(d.suggestion.budgetTjmMax.valeur) : "");
        setBudgetDevise(d.suggestion.budgetDevise?.valeur ?? "EUR");
        setChargement(false);
      })
      .catch((e) => {
        setErreur(e.message);
        setChargement(false);
      });
  }, [id]);

  async function creerDemande() {
    setCreationEnCours(true);
    setErreur(null);
    const reponse = await fetch(`/api/talent/besoins/${id}/creer-demande`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titre: titre.trim() || undefined,
        description: description.trim(),
        competencesExtraites: competences.split(",").map((c) => c.trim()).filter(Boolean),
        senioriteSouhaitee: seniorite.trim() || null,
        anneesExperienceMin: anneesExperience.trim() ? Number(anneesExperience) : null,
        localisation: localisation.trim() || null,
        mobilite: mobilite || null,
        disponibiliteSouhaitee: disponibilite.trim() || null,
        budgetTjmMax: budgetTjmMax.trim() ? Number(budgetTjmMax) : undefined,
        budgetDevise: budgetDevise.trim() || undefined,
      }),
    });
    const corps = await reponse.json();
    setCreationEnCours(false);
    if (!reponse.ok) {
      setErreur(corps.error ?? "Erreur lors de la création.");
      if (corps.demandeTalentId) router.push(`/admin/talent/${corps.demandeTalentId}`);
      return;
    }
    router.push(`/admin/talent/${corps.id}`);
  }

  if (chargement) return <p style={{ color: "#888" }}>Chargement…</p>;
  if (erreur && !detail) return <p style={{ color: rouge }}>{erreur}</p>;
  if (!detail) return null;

  const { besoin, client, profilFaitsActifs, eligibilite, demandeTalentCreee } = detail;

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ margin: 0 }}>
        <Link href="/admin/talent/besoins" style={{ color: bleu, fontSize: 13, textDecoration: "none" }}>
          ← Tous les besoins
        </Link>
      </p>
      <h1 style={{ marginTop: 8 }}>{besoin.titre ?? "Besoin client"}</h1>
      <p style={{ color: grisTexte, fontSize: 13 }}>
        {client.nom}
        {client.secteur ? ` · ${client.secteur}` : ""}
        {client.pays ? ` · ${client.pays}` : ""}
      </p>

      {demandeTalentCreee && (
        <div style={{ border: `1px solid ${vert}`, borderRadius: 8, padding: 12, marginBottom: 16, background: "#f2faf5" }}>
          <p style={{ margin: 0, fontSize: 13 }}>Une demande Talent existe déjà pour ce besoin.</p>
          <Link href={`/admin/talent/${demandeTalentCreee.id}`} style={{ fontSize: 13, color: bleu }}>
            Voir la demande →
          </Link>
        </div>
      )}

      {!demandeTalentCreee && !eligibilite.eligible && (
        <div style={{ border: `1px solid ${orange}`, borderRadius: 8, padding: 12, marginBottom: 16, background: "#fff8f0" }}>
          <p style={{ margin: 0, fontSize: 13, color: orange }}>{eligibilite.raison}</p>
        </div>
      )}

      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15 }}>Le besoin, tel qu&apos;exprimé par le client</h2>
        <p style={{ fontSize: 13, whiteSpace: "pre-wrap", border: `1px solid ${bordure}`, borderRadius: 8, padding: 12 }}>{besoin.texteOriginal}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {besoin.faits.map((f, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, border: `1px solid ${bordure}`, borderRadius: 999, padding: "2px 8px" }}>
              {f.cle} : {f.valeur} <BadgeProvenance statut={f.statut} />
            </span>
          ))}
        </div>
      </section>

      {profilFaitsActifs.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 15 }}>Contexte durable (Profil client)</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {profilFaitsActifs.map((f, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, border: `1px solid ${bordure}`, borderRadius: 999, padding: "2px 8px" }}>
                {f.cle} : {f.valeur} <BadgeProvenance statut={f.statut} />
              </span>
            ))}
          </div>
        </section>
      )}

      <SectionSolutions besoinId={besoin.id} besoinStatut={besoin.statut} />

      {!demandeTalentCreee && eligibilite.eligible && (
        <section>
          <h2 style={{ fontSize: 15 }}>Créer une demande Talent</h2>
          <p style={{ fontSize: 12, color: grisTexte }}>
            Les champs ci-dessous sont pré-remplis depuis le besoin — vérifiez et corrigez avant de créer la demande. Rien n&apos;est envoyé tant que
            vous n&apos;avez pas confirmé.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Titre</label>
              <input value={titre} onChange={(e) => setTitre(e.target.value)} style={champStyle} />
            </div>
            <div>
              <label style={labelStyle}>Séniorité souhaitée</label>
              <input value={seniorite} onChange={(e) => setSeniorite(e.target.value)} style={champStyle} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={champStyle} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Compétences (séparées par des virgules)</label>
              <input value={competences} onChange={(e) => setCompetences(e.target.value)} style={champStyle} />
            </div>
            <div>
              <label style={labelStyle}>Années d&apos;expérience minimum</label>
              <input type="number" min={0} value={anneesExperience} onChange={(e) => setAnneesExperience(e.target.value)} style={champStyle} />
            </div>
            <div>
              <label style={labelStyle}>Localisation</label>
              <input value={localisation} onChange={(e) => setLocalisation(e.target.value)} style={champStyle} />
            </div>
            <div>
              <label style={labelStyle}>
                Mobilité {detail.suggestion.remoteDeclare && <span style={{ fontWeight: 400 }}>(déclaré : &quot;{detail.suggestion.remoteDeclare.valeur}&quot;)</span>}
              </label>
              <select value={mobilite} onChange={(e) => setMobilite(e.target.value)} style={champStyle}>
                <option value="">—</option>
                <option value="Remote">Remote</option>
                <option value="Hybride">Hybride</option>
                <option value="Sur site">Sur site</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Disponibilité souhaitée</label>
              <input value={disponibilite} onChange={(e) => setDisponibilite(e.target.value)} style={champStyle} />
            </div>
            <div>
              <label style={labelStyle}>Budget TJM max</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input type="number" min={0} value={budgetTjmMax} onChange={(e) => setBudgetTjmMax(e.target.value)} style={champStyle} />
                <input value={budgetDevise} onChange={(e) => setBudgetDevise(e.target.value.toUpperCase())} maxLength={3} style={{ ...champStyle, width: 60 }} />
              </div>
            </div>
          </div>

          {erreur && <p style={{ color: rouge, fontSize: 13 }}>{erreur}</p>}

          {!confirmationVisible && (
            <button
              onClick={() => setConfirmationVisible(true)}
              disabled={description.trim().length < 10}
              style={{ marginTop: 16, background: bleu, color: "#fff", border: "none", borderRadius: 6, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              Créer une demande Talent
            </button>
          )}

          {confirmationVisible && (
            <div style={{ marginTop: 16, border: `1px solid ${bleu}`, borderRadius: 8, padding: 12, background: "#eaf0fd" }}>
              <p style={{ margin: "0 0 10px", fontSize: 13 }}>Cette action créera une nouvelle demande à partir du besoin sélectionné.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={creerDemande}
                  disabled={creationEnCours}
                  style={{ background: bleu, color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  {creationEnCours ? "Création…" : "Confirmer la création"}
                </button>
                <button
                  onClick={() => setConfirmationVisible(false)}
                  disabled={creationEnCours}
                  style={{ background: "#fff", color: grisTexte, border: `1px solid ${bordure}`, borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
