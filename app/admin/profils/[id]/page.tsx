"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { bleu, bleuFonce, grisTexte, bordure, fondClair, vert, orange, rouge } from "@/lib/theme";

// ATLAS PROFESSIONAL INTELLIGENCE CONSOLE — Phase 2A++ (28/09/2026).
//
// Premier écran qui branche l'intelligence déjà construite (Skill Graph,
// Evidence Confidence, Candidate/Talent Intelligence, Talent Trust) à une
// interface humaine. Ne recalcule RIEN : consomme telles quelles deux routes
// déjà existantes —
//   GET /api/profils/[id]/competences   (Skill Graph brut + preuves + confiance détaillée)
//   GET /api/profils/[id]/talent-trust  (étendu par ce lot pour exposer aussi
//                                        candidateIntelligence/talentIntelligence,
//                                        déjà calculés en mémoire par cette route)
// La seule action de mutation branchée dans cette première version est la
// (re)construction du Skill Graph (POST /api/profils/[id]/competences) —
// jamais une "validation" : elle ne fait que reconstruire une représentation
// à partir des données déclaratives/CV déjà là. Corriger une compétence
// (PATCH) ou ajouter une preuve manuelle (POST .../preuves) restent des
// routes existantes, volontairement non branchées ici (voir rapport final).

const GRIS_NEUTRE = "#9aa0ab";

type StatutPreuve = "VERIFIE" | "DECLARE" | "INFERE" | "INCONNU";
type SourcePreuve = "CV" | "PROFIL" | "CERTIFICATION" | "MISSION" | "EVALUATION" | "ASSESSMENT" | "ADMIN";
type CoherencePreuve = "COHERENTE" | "NON_VERIFIABLE" | "INCOHERENTE";
type NiveauConfianceDetaillee = "HAUTE" | "MOYENNE" | "BASSE" | "INCONNUE";

type SkillEvidenceApi = { id: string; source: SourcePreuve; detail: string | null; niveau: number | null; createdAt: string };

type EvidenceConfidenceApi = {
  competence: string;
  niveau: number | null;
  statut: StatutPreuve;
  provenancePrincipale: SourcePreuve | null;
  nombrePreuves: number;
  datePreuveLaPlusRecente: string | null;
  coherence: CoherencePreuve;
  confiance: NiveauConfianceDetaillee;
  explication: string;
};

type ProfilCompetenceApi = {
  id: string;
  competence: string;
  niveau: number | null;
  contexte: string | null;
  secteur: string | null;
  statut: StatutPreuve;
  preuves: SkillEvidenceApi[];
  confianceDetaillee: EvidenceConfidenceApi;
};

type DonneeSimple<T> = { valeur: T | null; statut: "DECLARE" | "INCONNU" };

type CompetenceIntelligenceApi = { competence: string; confianceDetaillee: EvidenceConfidenceApi };

type CandidateIntelligenceApi = {
  competences: {
    verifiees: CompetenceIntelligenceApi[];
    declarees: CompetenceIntelligenceApi[];
    preuvesFaibles: CompetenceIntelligenceApi[];
  };
  experience: { anneesExperience: DonneeSimple<number>; seniorite: DonneeSimple<string> };
  disponibilite: DonneeSimple<string>;
  localisation: DonneeSimple<string>;
  zonesInconnues: string[];
  contradictions: string[];
};

type ComposantTrustApi = { label: string; niveau: "HAUTE" | "MOYENNE" | "BASSE" | "INCONNUE"; evidence: string };

type TalentTrustApi = {
  composants: {
    forcePreuve: ComposantTrustApi;
    provenance: ComposantTrustApi;
    fraicheur: ComposantTrustApi;
    coherence: ComposantTrustApi;
    historiqueMissions: ComposantTrustApi;
    historiqueEvaluations: ComposantTrustApi;
    completude: ComposantTrustApi;
  };
  niveauGlobal: "HAUTE" | "MOYENNE" | "BASSE" | "DONNEES_INSUFFISANTES";
  explicationGlobale: string;
};

type TalentTrustReponse = {
  nom: string;
  prenom: string | null;
  candidateIntelligence: CandidateIntelligenceApi;
  talentTrust: TalentTrustApi;
};

const LABEL_STATUT: Record<StatutPreuve, string> = {
  VERIFIE: "Vérifié",
  DECLARE: "Déclaré",
  INFERE: "Inféré",
  INCONNU: "Inconnu",
};

function couleurNiveau(niveau: "HAUTE" | "MOYENNE" | "BASSE" | "INCONNUE" | "DONNEES_INSUFFISANTES"): string {
  if (niveau === "HAUTE") return vert;
  if (niveau === "MOYENNE") return orange;
  if (niveau === "BASSE") return rouge;
  return GRIS_NEUTRE; // INCONNUE / DONNEES_INSUFFISANTES
}

function couleurStatut(statut: StatutPreuve): string {
  if (statut === "VERIFIE") return vert;
  if (statut === "DECLARE") return bleu;
  if (statut === "INFERE") return orange;
  return GRIS_NEUTRE;
}

function Badge({ texte, couleur }: { texte: string; couleur: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 9px",
        borderRadius: 999,
        color: couleur,
        background: couleur + "1a",
        border: `1px solid ${couleur}`,
        whiteSpace: "nowrap",
      }}
    >
      {texte}
    </span>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2
        style={{
          fontSize: 13,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          color: bleu,
          fontWeight: 700,
          marginBottom: 12,
          paddingBottom: 6,
          borderBottom: `1px solid ${bordure}`,
        }}
      >
        {titre}
      </h2>
      {children}
    </section>
  );
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR") : "—";
}

export default function ProfilIntelligencePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [chargement, setChargement] = useState(true);
  const [statutHttp, setStatutHttp] = useState<number | null>(null);
  const [competences, setCompetences] = useState<ProfilCompetenceApi[] | null>(null);
  const [trust, setTrust] = useState<TalentTrustReponse | null>(null);
  const [competenceSelectionnee, setCompetenceSelectionnee] = useState<string | null>(null);
  const [construction, setConstruction] = useState(false);
  const [erreurConstruction, setErreurConstruction] = useState("");

  async function charger() {
    setChargement(true);
    const [resCompetences, resTrust] = await Promise.all([
      fetch(`/api/profils/${id}/competences`),
      fetch(`/api/profils/${id}/talent-trust`),
    ]);

    // Les deux routes portent sur le même profil : un statut non-200 sur
    // l'une (403 non-admin, 404 profil introuvable) s'applique à la page
    // entière — jamais un affichage partiel avec des données manquantes
    // silencieuses.
    const statut = !resCompetences.ok ? resCompetences.status : !resTrust.ok ? resTrust.status : 200;
    setStatutHttp(statut);

    if (statut === 200) {
      const donneesCompetences: ProfilCompetenceApi[] = await resCompetences.json();
      const donneesTrust: TalentTrustReponse = await resTrust.json();
      setCompetences(donneesCompetences);
      setTrust(donneesTrust);
      if (competenceSelectionnee && !donneesCompetences.some((c) => c.id === competenceSelectionnee)) {
        setCompetenceSelectionnee(null);
      }
    }
    setChargement(false);
  }

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function construireSkillGraph() {
    setErreurConstruction("");
    setConstruction(true);
    const res = await fetch(`/api/profils/${id}/competences`, { method: "POST" });
    setConstruction(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErreurConstruction(data.error ?? "Échec de la construction du Skill Graph.");
      return;
    }
    await charger();
  }

  if (chargement) {
    return <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>Chargement...</main>;
  }

  if (statutHttp === 403) {
    return (
      <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
        <p style={{ fontSize: 14, color: rouge }}>Accès réservé à l&apos;administrateur.</p>
      </main>
    );
  }

  if (statutHttp === 404 || !competences || !trust) {
    return (
      <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
        <p style={{ fontSize: 14, color: grisTexte }}>Profil introuvable.</p>
        <Link href="/admin/profils" style={{ fontSize: 13, color: bleu }}>
          ← Retour à la liste des profils
        </Link>
      </main>
    );
  }

  const { candidateIntelligence, talentTrust, nom, prenom } = trust;
  const competenceActive = competences.find((c) => c.id === competenceSelectionnee) ?? null;

  const verifiees = competences.filter((c) => c.statut === "VERIFIE");
  const declarees = competences.filter((c) => c.statut === "DECLARE");
  const inferees = competences.filter((c) => c.statut === "INFERE");

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 0 60px" }}>
      <Link href="/admin/profils" style={{ fontSize: 13, color: bleu, marginBottom: 16, display: "inline-block" }}>
        ← Profils
      </Link>

      {/* ───────────────────────── HEADER — Identité professionnelle ───────────────────────── */}
      <Section titre="Identité professionnelle">
        <h1 style={{ fontSize: 22, margin: "0 0 12px", color: bleuFonce }}>
          {prenom ? `${prenom} ${nom}` : nom}
        </h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, fontSize: 14 }}>
          <ChampIdentite label="Expérience" donnee={candidateIntelligence.experience.anneesExperience} suffixe=" an(s)" />
          <ChampIdentite label="Séniorité" donnee={candidateIntelligence.experience.seniorite} />
          <ChampIdentite label="Disponibilité" donnee={candidateIntelligence.disponibilite} />
          <ChampIdentite label="Localisation" donnee={candidateIntelligence.localisation} />
        </div>
        <p style={{ fontSize: 12, color: GRIS_NEUTRE, marginTop: 10 }}>
          Le score de profil existant (voir /admin/profils) n&apos;est pas dupliqué ici — cette console est centrée
          sur la preuve et la provenance, pas sur un score de synthèse.
        </p>
      </Section>

      {/* ───────────────────────── ATLAS PROFESSIONAL INTELLIGENCE ───────────────────────── */}
      <Section titre="ATLAS Professional Intelligence — ce qu'ATLAS sait">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
          <BlocResume titre="Vérifié" couleur={vert} valeur={verifiees.length} detail="statut VERIFIE, confirmé par un Admin" />
          <BlocResume titre="Déclaré" couleur={bleu} valeur={declarees.length} detail="déclaré par l'ingénieur, non confirmé" />
          <BlocResume titre="Inféré" couleur={orange} valeur={inferees.length} detail="détecté automatiquement (IA), non confirmé" />
          <BlocResume
            titre="À vérifier"
            couleur={rouge}
            valeur={candidateIntelligence.competences.preuvesFaibles.length}
            detail="preuve faible ou incohérence détectée"
          />
          <BlocResume
            titre="Inconnu"
            couleur={GRIS_NEUTRE}
            valeur={candidateIntelligence.zonesInconnues.length}
            detail="zone(s) du profil non renseignée(s)"
          />
        </div>
      </Section>

      {/* ───────────────────────── SKILL GRAPH ───────────────────────── */}
      <Section titre="Skill Graph">
        {competences.length === 0 ? (
          <div style={{ border: `1px dashed ${bordure}`, borderRadius: 8, padding: 20 }}>
            <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 6px", color: bleuFonce }}>
              Skill Graph non construit pour ce profil.
            </p>
            <p style={{ fontSize: 13, color: grisTexte, margin: "0 0 14px" }}>
              ATLAS dispose de données déclaratives mais aucune représentation Skill Graph n&apos;a encore été
              construite pour ce profil.
            </p>
            {erreurConstruction && <p style={{ color: rouge, fontSize: 13, marginBottom: 10 }}>{erreurConstruction}</p>}
            <button
              onClick={construireSkillGraph}
              disabled={construction}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                background: bleu,
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: construction ? "default" : "pointer",
              }}
            >
              {construction ? "Construction en cours..." : "Construire le Skill Graph"}
            </button>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            {erreurConstruction && <p style={{ color: rouge, fontSize: 13, marginBottom: 10 }}>{erreurConstruction}</p>}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: `1px solid ${bordure}` }}>
                  <th style={{ padding: "6px 8px" }}>Compétence</th>
                  <th style={{ padding: "6px 8px" }}>Statut</th>
                  <th style={{ padding: "6px 8px" }}>Niveau</th>
                  <th style={{ padding: "6px 8px" }}>Confiance</th>
                  <th style={{ padding: "6px 8px" }}>Provenance</th>
                  <th style={{ padding: "6px 8px" }}>Cohérence</th>
                  <th style={{ padding: "6px 8px" }}>Preuves</th>
                  <th style={{ padding: "6px 8px" }}>Dernière preuve</th>
                </tr>
              </thead>
              <tbody>
                {competences.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setCompetenceSelectionnee(c.id)}
                    style={{
                      borderBottom: `1px solid #f0f0f0`,
                      cursor: "pointer",
                      background: competenceSelectionnee === c.id ? fondClair : "transparent",
                    }}
                  >
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>{c.competence}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <Badge texte={LABEL_STATUT[c.statut]} couleur={couleurStatut(c.statut)} />
                    </td>
                    <td style={{ padding: "6px 8px" }}>{c.niveau ?? "—"}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <Badge texte={c.confianceDetaillee.confiance} couleur={couleurNiveau(c.confianceDetaillee.confiance)} />
                    </td>
                    <td style={{ padding: "6px 8px" }}>{c.confianceDetaillee.provenancePrincipale ?? "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{c.confianceDetaillee.coherence}</td>
                    <td style={{ padding: "6px 8px" }}>{c.confianceDetaillee.nombrePreuves}</td>
                    <td style={{ padding: "6px 8px" }}>{formatDate(c.confianceDetaillee.datePreuveLaPlusRecente)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 12, color: GRIS_NEUTRE, marginTop: 8 }}>Cliquez une ligne pour voir ses preuves ci-dessous.</p>
          </div>
        )}
      </Section>

      {/* ───────────────────────── EVIDENCE ───────────────────────── */}
      {competences.length > 0 && (
        <Section titre="Evidence">
          {!competenceActive ? (
            <p style={{ fontSize: 13, color: GRIS_NEUTRE }}>Sélectionnez une compétence dans le Skill Graph ci-dessus.</p>
          ) : competenceActive.preuves.length === 0 ? (
            <p style={{ fontSize: 13, color: GRIS_NEUTRE }}>
              Aucune preuve enregistrée pour « {competenceActive.competence} ».
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: bleuFonce, margin: 0 }}>{competenceActive.competence}</p>
              {[...competenceActive.preuves]
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .map((p) => (
                  <div key={p.id} style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 10, fontSize: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <Badge texte={p.source} couleur={GRIS_NEUTRE} />
                      <span style={{ fontSize: 12, color: GRIS_NEUTRE }}>{formatDate(p.createdAt)}</span>
                    </div>
                    {p.detail && <p style={{ margin: "6px 0 0" }}>{p.detail}</p>}
                    {p.niveau != null && <p style={{ margin: "4px 0 0", color: grisTexte }}>Niveau observé : {p.niveau}</p>}
                  </div>
                ))}
            </div>
          )}
        </Section>
      )}

      {/* ───────────────────────── TALENT TRUST ───────────────────────── */}
      <Section titre="Talent Trust">
        <div
          style={{
            border: `1px solid ${couleurNiveau(talentTrust.niveauGlobal)}`,
            background: couleurNiveau(talentTrust.niveauGlobal) + "0d",
            borderRadius: 8,
            padding: 12,
            marginBottom: 14,
          }}
        >
          <Badge texte={talentTrust.niveauGlobal} couleur={couleurNiveau(talentTrust.niveauGlobal)} />
          <p style={{ fontSize: 13, color: bleuFonce, margin: "8px 0 0" }}>{talentTrust.explicationGlobale}</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          {Object.values(talentTrust.composants).map((c) => (
            <div key={c.label} style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: bleuFonce }}>{c.label}</span>
                <Badge texte={c.niveau} couleur={couleurNiveau(c.niveau)} />
              </div>
              <p style={{ fontSize: 12, color: grisTexte, margin: 0 }}>{c.evidence}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ───────────────────────── CONTRADICTIONS ───────────────────────── */}
      {candidateIntelligence.contradictions.length > 0 && (
        <Section titre="Contradictions">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {candidateIntelligence.contradictions.map((texte) => (
              <div key={texte} style={{ border: `1px solid ${rouge}`, background: rouge + "0d", borderRadius: 8, padding: 10, fontSize: 13 }}>
                {texte}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ───────────────────────── ZONES INCONNUES ───────────────────────── */}
      <Section titre="Zones inconnues">
        {candidateIntelligence.zonesInconnues.length === 0 ? (
          <p style={{ fontSize: 13, color: GRIS_NEUTRE }}>Aucune zone inconnue identifiée sur ce profil.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
            {candidateIntelligence.zonesInconnues.map((texte) => (
              <li key={texte} style={{ fontSize: 13, color: grisTexte }}>
                {texte}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  );
}

function ChampIdentite<T>({ label, donnee, suffixe = "" }: { label: string; donnee: DonneeSimple<T>; suffixe?: string }) {
  return (
    <div>
      <p style={{ fontSize: 11, textTransform: "uppercase", color: GRIS_NEUTRE, margin: "0 0 2px" }}>{label}</p>
      {donnee.statut === "INCONNU" ? (
        <span style={{ color: GRIS_NEUTRE }}>Inconnu</span>
      ) : (
        <span style={{ color: bleuFonce, fontWeight: 600 }}>
          {String(donnee.valeur)}
          {suffixe}
        </span>
      )}
    </div>
  );
}

function BlocResume({ titre, couleur, valeur, detail }: { titre: string; couleur: string; valeur: number; detail: string }) {
  return (
    <div style={{ border: `1px solid ${couleur}`, background: couleur + "0d", borderRadius: 8, padding: 12 }}>
      <p style={{ fontSize: 20, fontWeight: 700, margin: 0, color: couleur }}>{valeur}</p>
      <p style={{ fontSize: 12, fontWeight: 600, color: bleuFonce, margin: "4px 0 2px" }}>{titre}</p>
      <p style={{ fontSize: 11, color: grisTexte, margin: 0 }}>{detail}</p>
    </div>
  );
}
