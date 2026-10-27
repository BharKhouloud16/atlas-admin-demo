"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { bleu, bordure, grisTexte, vert, orange, rouge } from "@/lib/theme";

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
  clientId: string;
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
  dateDebutSouhaitee: string | null;
  analyseProvider: string | null;
  criteresModifiesParEmail: string | null;
  criteresModifiesLe: string | null;
  // LOT 6 — Mission Context Bridge (16/09/2026).
  missions: { id: string }[];
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
            <FicheCompleteCandidat profilId={e.profilId} />
          </li>
        ))}
      </ul>

      <CreerMission demande={demande} shortlist={shortlist} />
    </div>
  );
}

// ENGINEER PROFILE V2 — ATLAS PROFESSIONAL CAPABILITY TWIN — Lot 1.
//
// Supprime le fossé entre /admin/talent/[id] (shortlist : score/confiance/
// motifs) et /admin/profils (CV/Skill Graph/portfolio) : un Admin peut
// désormais ouvrir la fiche complète d'un candidat shortlisté SANS changer
// de page. Réutilise entièrement GET /api/profils/[id]/fiche-complete (Lot
// 1), qui compose lui-même les moteurs existants (Talent Trust, Skill
// Graph, Mission Intelligence, Professional Memory) — aucun nouveau calcul
// ici, uniquement de l'affichage. Chargée à la demande (accordéon fermé par
// défaut) : "intelligence complexe derrière, expérience simple devant."
type FicheComplete = {
  profilId: string;
  identite: {
    nom: string;
    prenom: string | null;
    seniorite: string | null;
    anneesExperience: number | null;
    disponibilite: string | null;
    fraicheurDisponibilite: "RECENTE" | "VIEILLISSANTE" | "OBSOLETE" | "INCONNUE";
    explicationFraicheurDisponibilite: string;
    paysResidence: string | null;
    cvValide: boolean;
  };
  skillGraph: {
    id: string;
    competence: string;
    statut: "VERIFIE" | "DECLARE" | "INFERE" | "INCONNU";
    niveau: number | null;
    confianceDetaillee: { confiance: string; explication: string; nombrePreuves: number };
  }[];
  certifications: { id: string; nom: string; organisme: string | null; statut: string }[];
  langues: { id: string; langue: string; niveau: string | null; statut: string }[];
  missions: { id: string; repere: string | null; statut: string; evaluation: { note: number } | null }[];
  memoireProfessionnelle: { competence: string; missions: { id: string; repere: string | null }[] }[];
  foundation: {
    talentTrust: {
      niveauGlobal: string;
      composants: Record<string, { label: string; niveau: string; evidence: string }>;
    };
  };
};

const COULEUR_STATUT: Record<string, string> = { VERIFIE: vert, DECLARE: bleu, INFERE: orange, INCONNU: grisTexte, OBSOLETE: rouge, VIEILLISSANTE: orange, RECENTE: vert, INCONNUE: grisTexte };

function FicheCompleteCandidat({ profilId }: { profilId: string }) {
  const [ouverte, setOuverte] = useState(false);
  const [fiche, setFiche] = useState<FicheComplete | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function basculer() {
    if (ouverte) {
      setOuverte(false);
      return;
    }
    setOuverte(true);
    if (fiche) return; // déjà chargée une première fois — jamais un refetch inutile
    setChargement(true);
    setErreur(null);
    const reponse = await fetch(`/api/profils/${profilId}/fiche-complete`);
    setChargement(false);
    if (!reponse.ok) {
      setErreur("Impossible de charger la fiche complète.");
      return;
    }
    setFiche(await reponse.json());
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={basculer}
        style={{ fontSize: 12, padding: "4px 10px", background: "none", color: bleu, border: `1px solid ${bleu}`, borderRadius: 6, cursor: "pointer" }}
      >
        {ouverte ? "▲ Masquer la fiche complète" : "▼ Voir la fiche complète"}
      </button>
      {ouverte && chargement && <p style={{ fontSize: 12, color: "#888", margin: "8px 0 0" }}>Chargement…</p>}
      {ouverte && erreur && <p style={{ fontSize: 12, color: rouge, margin: "8px 0 0" }}>{erreur}</p>}
      {ouverte && fiche && (
        <div style={{ marginTop: 10, border: `1px solid ${bordure}`, borderRadius: 8, padding: 12, background: "#fafbfd", display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionIdentite fiche={fiche} />
          <SectionTrust trust={fiche.foundation.talentTrust} />
          <SectionSkills skillGraph={fiche.skillGraph} memoire={fiche.memoireProfessionnelle} />
          {(fiche.certifications.length > 0 || fiche.langues.length > 0) && <SectionCertificationsLangues fiche={fiche} />}
          <SectionMissions missions={fiche.missions} />
        </div>
      )}
    </div>
  );
}

function Badge({ texte, couleur }: { texte: string; couleur: string }) {
  return (
    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, border: `1px solid ${couleur}`, color: couleur, whiteSpace: "nowrap" }}>
      {texte}
    </span>
  );
}

function SectionIdentite({ fiche }: { fiche: FicheComplete }) {
  const { identite } = fiche;
  return (
    <div>
      <h3 style={titreSection}>Identité</h3>
      <p style={{ margin: 0, fontSize: 12, color: grisTexte }}>
        {identite.seniorite ?? "Séniorité non déterminée"}
        {identite.anneesExperience != null ? ` · ${identite.anneesExperience} an(s) d'expérience` : ""}
        {identite.paysResidence ? ` · ${identite.paysResidence}` : ""}
        {!identite.cvValide && " · CV non encore validé"}
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <span>{identite.disponibilite ?? "Disponibilité non renseignée"}</span>
        <Badge texte={identite.fraicheurDisponibilite} couleur={COULEUR_STATUT[identite.fraicheurDisponibilite]} />
      </p>
      <p style={{ margin: "2px 0 0", fontSize: 11, color: "#888" }}>{identite.explicationFraicheurDisponibilite}</p>
    </div>
  );
}

function SectionTrust({ trust }: { trust: FicheComplete["foundation"]["talentTrust"] }) {
  return (
    <div>
      <h3 style={titreSection}>
        Talent Trust <Badge texte={trust.niveauGlobal} couleur={COULEUR_STATUT[trust.niveauGlobal] ?? grisTexte} />
      </h3>
      <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        {Object.values(trust.composants).map((c) => (
          <li key={c.label} style={{ fontSize: 11, color: grisTexte }}>
            <Badge texte={c.niveau} couleur={COULEUR_STATUT[c.niveau] ?? grisTexte} /> {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionSkills({ skillGraph, memoire }: { skillGraph: FicheComplete["skillGraph"]; memoire: FicheComplete["memoireProfessionnelle"] }) {
  const missionsParCompetence = new Map(memoire.map((m) => [m.competence, m.missions]));
  if (skillGraph.length === 0) {
    return <p style={{ fontSize: 12, color: "#888", margin: 0 }}>Aucune compétence sur le Skill Graph pour ce candidat.</p>;
  }
  return (
    <div>
      <h3 style={titreSection}>Compétences &amp; preuves</h3>
      <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
        {skillGraph.map((c) => {
          const missions = missionsParCompetence.get(c.competence) ?? [];
          return (
            <li key={c.id} style={{ fontSize: 12 }}>
              <Badge texte={c.statut} couleur={COULEUR_STATUT[c.statut]} />{" "}
              <strong>{c.competence}</strong>
              {c.niveau != null && ` (niveau ${c.niveau}/5)`}
              <span style={{ color: "#888" }}> — {c.confianceDetaillee.explication}</span>
              {missions.length > 0 && (
                <span style={{ color: bleu }}>
                  {" "}
                  · prouvée par {missions.length} mission(s) : {missions.map((m) => m.repere ?? m.id.slice(0, 6)).join(", ")}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SectionCertificationsLangues({ fiche }: { fiche: FicheComplete }) {
  return (
    <div>
      <h3 style={titreSection}>Certifications &amp; langues</h3>
      <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
        {fiche.certifications.map((c) => (
          <li key={c.id} style={{ fontSize: 12 }}>
            <Badge texte={c.statut} couleur={COULEUR_STATUT[c.statut]} /> {c.nom}
            {c.organisme && ` (${c.organisme})`}
          </li>
        ))}
        {fiche.langues.map((l) => (
          <li key={l.id} style={{ fontSize: 12 }}>
            <Badge texte={l.statut} couleur={COULEUR_STATUT[l.statut]} /> {l.langue}
            {l.niveau && ` — ${l.niveau}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionMissions({ missions }: { missions: FicheComplete["missions"] }) {
  if (missions.length === 0) {
    return <p style={{ fontSize: 12, color: "#888", margin: 0 }}>Aucune mission dans l&apos;historique de ce candidat.</p>;
  }
  return (
    <div>
      <h3 style={titreSection}>Missions &amp; résultats</h3>
      <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
        {missions.map((m) => (
          <li key={m.id} style={{ fontSize: 12, color: grisTexte }}>
            {m.repere ?? m.id.slice(0, 6)} — {m.statut}
            {m.evaluation && ` · évaluation ${m.evaluation.note}/5`}
          </li>
        ))}
      </ul>
    </div>
  );
}

const titreSection: React.CSSProperties = { margin: 0, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, color: "#888" };

const MODES_TRAVAIL = ["Remote", "Hybride", "Sur site"] as const;

// COMPANY ATLAS — LOT 6 : Mission Context Bridge (16/09/2026).
//
// Rend visible et exploitable la continuité Besoin -> Demande -> Mission
// directement où l'Admin prend déjà sa décision (une fois un profil
// VALIDEE en shortlist) — sans nouvel écran, sans dupliquer le formulaire
// de /admin/missions. dateDebut/modeTravail sont pré-remplis depuis la
// demande (jamais imposés) ; le clientId n'est jamais envoyé par ce
// formulaire, il est dérivé côté serveur depuis sourceDemandeId (voir
// POST /api/missions) — aucun risque de rattachement au mauvais client.
function CreerMission({ demande, shortlist }: { demande: DemandeAdmin; shortlist: ShortlistEntree[] }) {
  const candidats = shortlist.filter((e) => e.statut === "VALIDEE");
  const [profilId, setProfilId] = useState("");
  const [repere, setRepere] = useState("");
  const [nbJours, setNbJours] = useState("");
  const [tjmVente, setTjmVente] = useState(demande.budgetTjmMax != null ? String(demande.budgetTjmMax) : "");
  const [dateDebut, setDateDebut] = useState(demande.dateDebutSouhaitee ? demande.dateDebutSouhaitee.slice(0, 10) : "");
  const [modeTravail, setModeTravail] = useState(demande.mobilite && (MODES_TRAVAIL as readonly string[]).includes(demande.mobilite) ? demande.mobilite : "");
  const [creation, setCreation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [missionCreeeId, setMissionCreeeId] = useState<string | null>(null);

  if (demande.missions.length > 0 && !missionCreeeId) {
    return (
      <div style={{ border: `1px solid ${bleu}`, borderRadius: 8, padding: 16, margin: "16px 0", background: "#eaf0fd" }}>
        <p style={{ margin: 0, fontSize: 13 }}>
          {demande.missions.length === 1 ? "Une mission a déjà été créée depuis cette demande." : `${demande.missions.length} missions ont déjà été créées depuis cette demande.`}{" "}
          <Link href="/admin/missions" style={{ color: bleu }}>Voir les missions →</Link>
        </p>
      </div>
    );
  }

  if (missionCreeeId) {
    return (
      <div style={{ border: `1px solid #1a7f4b`, borderRadius: 8, padding: 16, margin: "16px 0", background: "#f2faf5" }}>
        <p style={{ margin: 0, fontSize: 13 }}>
          Mission créée. <Link href="/admin/missions" style={{ color: bleu }}>Voir les missions →</Link>
        </p>
      </div>
    );
  }

  if (candidats.length === 0) return null;

  async function creerMission() {
    if (!profilId || !nbJours || !tjmVente) {
      setErreur("Ingénieur, nombre de jours et TJM vente sont requis.");
      return;
    }
    setErreur(null);
    setCreation(true);
    const reponse = await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceDemandeId: demande.id,
        profilId,
        repere: repere || undefined,
        nbJours: Number(nbJours),
        tjmVente: Number(tjmVente),
        dateDebut: dateDebut || undefined,
        modeTravail: modeTravail || undefined,
      }),
    });
    setCreation(false);
    if (!reponse.ok) {
      const data = await reponse.json().catch(() => ({}));
      setErreur(data.error ?? "Erreur lors de la création de la mission.");
      return;
    }
    const mission = await reponse.json();
    setMissionCreeeId(mission.id);
  }

  return (
    <div style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 16, margin: "16px 0" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 15 }}>Créer une mission</h2>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "#888" }}>
        À partir d&apos;un ingénieur validé — le contexte (période, mode de travail) est pré-rempli depuis cette demande, modifiable avant création.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Ingénieur validé</label>
          <select value={profilId} onChange={(e) => setProfilId(e.target.value)} style={champStyle}>
            <option value="">Choisir…</option>
            {candidats.map((c) => (
              <option key={c.profilId} value={c.profilId}>
                {c.profil.prenom ? `${c.profil.prenom} ${c.profil.nom}` : c.profil.nom}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Repère (optionnel)</label>
          <input value={repere} onChange={(e) => setRepere(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>Nombre de jours</label>
          <input type="number" min={1} value={nbJours} onChange={(e) => setNbJours(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>TJM vente (€)</label>
          <input type="number" min={0} value={tjmVente} onChange={(e) => setTjmVente(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>Date de début</label>
          <input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} style={champStyle} />
        </div>
        <div>
          <label style={labelStyle}>Mode de travail</label>
          <select value={modeTravail} onChange={(e) => setModeTravail(e.target.value)} style={champStyle}>
            <option value="">—</option>
            {MODES_TRAVAIL.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>
      {erreur && <p style={{ color: "#c0392b", fontSize: 13, margin: "12px 0 0" }}>{erreur}</p>}
      <button
        onClick={creerMission}
        disabled={creation}
        style={{ marginTop: 12, fontSize: 13, padding: "8px 16px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
      >
        {creation ? "Création…" : "Créer la mission"}
      </button>
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
