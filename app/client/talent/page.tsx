"use client";

import { useEffect, useState } from "react";
import { bordure, grisTexte } from "@/lib/theme";
import { Card, Section, EmptyState, Badge, Bouton } from "@/components/client/primitives";
import { TOUTES_COMPETENCES } from "@/lib/competences";

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
//
// LOT 15.5 — Client Requirement Builder : ajoute, pour chaque demande, un
// parcours self-service complet (RequirementBuilder ci-dessous) qui
// n'existait pas jusqu'ici — le circuit historique au-dessus reste
// entièrement inchangé (création de la demande, suivi de son statut par
// l'Admin). Les deux coexistent : la demande reste la même DemandeTalent,
// le nouveau parcours ajoute uniquement un besoin structuré et un matching
// immédiat, anonymisé, jamais un remplacement du circuit Admin existant.
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
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${bordure}` }}>
                <RequirementBuilder demandeId={d.id} descriptionInitiale={d.description} />
              </div>
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

// --- LOT 15.5 — Client Requirement Builder ---------------------------------

type CritereRequirement = { valeur: string; priorite: "REQUIRED" | "PREFERRED" | "OPTIONAL" };

type RequirementStructure = {
  role: string | null;
  experienceMinAnnees: number | null;
  skills: CritereRequirement[];
  certifications: CritereRequirement[];
  disponibilite: string | null;
  localisation: string | null;
  domaine: string | null;
  contraintes: string[];
  champsInconnus: string[];
  provider: "anthropic" | "local" | "guided";
  confiance: number;
};

type CandidatAnonyme = {
  ingenieurId: string;
  seniorite: string | null;
  anneesExperience: number | null;
  disponibilite: string | null;
  localisation: string | null;
  competencesCorrespondantes: string[];
  pointsAmeliorer: string[];
  informationsManquantes: string[];
  explication: string;
};

type Etape = "choix" | "libre" | "guide" | "revue" | "resultats";

// Parcours self-service complet d'une demande : Mode 1 (texte libre ->
// analyse IA/heuristique -> revue/correction par le Client) ou Mode 2
// (critères choisis directement), puis matching immédiat, résultats
// anonymisés. "L'IA propose, le Client décide" (Partie E du mandat) : le
// besoin n'est jamais confirmé (PATCH .../besoin) sans une action explicite
// du Client sur l'écran de revue.
function RequirementBuilder({ demandeId, descriptionInitiale }: { demandeId: string; descriptionInitiale: string }) {
  const [etape, setEtape] = useState<Etape>("choix");
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [brouillon, setBrouillon] = useState<RequirementStructure | null>(null);
  const [texteLibre, setTexteLibre] = useState(descriptionInitiale);
  const [resultats, setResultats] = useState<CandidatAnonyme[] | null>(null);
  const [messageVide, setMessageVide] = useState<string | null>(null);

  async function analyser() {
    setErreur(null);
    setChargement(true);
    const reponse = await fetch(`/api/talent/demandes/${demandeId}/besoin/analyser`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: texteLibre }),
    });
    setChargement(false);
    if (!reponse.ok) {
      const d = await reponse.json().catch(() => ({}));
      setErreur(d.error ?? "Analyse impossible, réessayez.");
      return;
    }
    const { requirement } = await reponse.json();
    setBrouillon(requirement);
    setEtape("revue");
  }

  function demarrerGuide() {
    setBrouillon({
      role: null,
      experienceMinAnnees: null,
      skills: [],
      certifications: [],
      disponibilite: null,
      localisation: null,
      domaine: null,
      contraintes: [],
      champsInconnus: [],
      provider: "guided",
      confiance: 1,
    });
    setEtape("guide");
  }

  async function confirmer() {
    if (!brouillon) return;
    setErreur(null);
    setChargement(true);
    const reponse = await fetch(`/api/talent/demandes/${demandeId}/besoin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requirement: brouillon }),
    });
    setChargement(false);
    if (!reponse.ok) {
      const d = await reponse.json().catch(() => ({}));
      setErreur(d.error ?? "Confirmation impossible, réessayez.");
      return;
    }
    await lancerMatching();
  }

  async function lancerMatching() {
    setErreur(null);
    setChargement(true);
    const reponse = await fetch(`/api/talent/demandes/${demandeId}/besoin/matcher`, { method: "POST" });
    setChargement(false);
    if (!reponse.ok) {
      const d = await reponse.json().catch(() => ({}));
      setErreur(d.error ?? "Matching impossible, réessayez.");
      return;
    }
    const data = await reponse.json();
    setResultats(data.resultats);
    setMessageVide(data.message ?? null);
    setEtape("resultats");
  }

  if (etape === "choix") {
    return (
      <div style={{ display: "flex", gap: 8 }}>
        <Bouton variant="secondary" onClick={() => setEtape("libre")}>
          Décrire mon besoin (analyse automatique)
        </Bouton>
        <Bouton variant="secondary" onClick={demarrerGuide}>
          Choisir mes critères
        </Bouton>
      </div>
    );
  }

  if (etape === "libre") {
    return (
      <div>
        <textarea
          value={texteLibre}
          onChange={(e) => setTexteLibre(e.target.value)}
          rows={3}
          style={{ width: "100%", padding: 8, fontFamily: "inherit", marginBottom: 8, border: `1px solid ${bordure}`, borderRadius: 6 }}
        />
        {erreur && <p style={{ color: "#c0392b", fontSize: 13, margin: "0 0 8px" }}>{erreur}</p>}
        <Bouton onClick={analyser} disabled={texteLibre.trim().length < 10 || chargement}>
          {chargement ? "Analyse…" : "Analyser mon besoin"}
        </Bouton>
      </div>
    );
  }

  if (etape === "guide" && brouillon) {
    return <FormulaireCriteresGuides brouillon={brouillon} onChange={setBrouillon} onValider={() => setEtape("revue")} />;
  }

  if (etape === "revue" && brouillon) {
    return (
      <RevueBesoin
        brouillon={brouillon}
        onChange={setBrouillon}
        onConfirmer={confirmer}
        erreur={erreur}
        chargement={chargement}
      />
    );
  }

  if (etape === "resultats") {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Profils correspondants (identité protégée)</p>
          <Bouton variant="secondary" onClick={lancerMatching} disabled={chargement}>
            {chargement ? "…" : "Relancer le matching"}
          </Bouton>
        </div>
        {messageVide && <EmptyState message={messageVide} />}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(resultats ?? []).map((c) => (
            <CandidatCard key={c.ingenieurId} candidat={c} />
          ))}
        </div>
      </div>
    );
  }

  return null;
}

function FormulaireCriteresGuides({
  brouillon,
  onChange,
  onValider,
}: {
  brouillon: RequirementStructure;
  onChange: (r: RequirementStructure) => void;
  onValider: () => void;
}) {
  function toggleSkill(competence: string, priorite: "REQUIRED" | "PREFERRED") {
    const existe = brouillon.skills.find((s) => s.valeur === competence);
    let skills: CritereRequirement[];
    if (existe && existe.priorite === priorite) {
      skills = brouillon.skills.filter((s) => s.valeur !== competence); // décoche
    } else {
      skills = [...brouillon.skills.filter((s) => s.valeur !== competence), { valeur: competence, priorite }];
    }
    onChange({ ...brouillon, skills });
  }

  return (
    <div style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 12 }}>
      <p style={{ fontSize: 12, color: grisTexte, margin: "0 0 8px" }}>
        Choisissez vos critères. « Obligatoire » filtre strictement les profils ; « Souhaité » les départage seulement.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          type="number"
          placeholder="Expérience min. (années)"
          value={brouillon.experienceMinAnnees ?? ""}
          onChange={(e) => onChange({ ...brouillon, experienceMinAnnees: e.target.value ? Number(e.target.value) : null })}
          style={{ padding: 8, border: `1px solid ${bordure}`, borderRadius: 6, width: 200 }}
        />
        <input
          placeholder="Disponibilité souhaitée (ex. immédiate)"
          value={brouillon.disponibilite ?? ""}
          onChange={(e) => onChange({ ...brouillon, disponibilite: e.target.value || null })}
          style={{ padding: 8, border: `1px solid ${bordure}`, borderRadius: 6, width: 240 }}
        />
        <input
          placeholder="Localisation souhaitée"
          value={brouillon.localisation ?? ""}
          onChange={(e) => onChange({ ...brouillon, localisation: e.target.value || null })}
          style={{ padding: 8, border: `1px solid ${bordure}`, borderRadius: 6, width: 220 }}
        />
      </div>
      <p style={{ fontSize: 12, fontWeight: 600, margin: "8px 0 4px" }}>Compétences</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 180, overflowY: "auto" }}>
        {TOUTES_COMPETENCES.map((c) => {
          const critere = brouillon.skills.find((s) => s.valeur === c);
          return (
            <button
              key={c}
              onClick={() => toggleSkill(c, critere?.priorite === "REQUIRED" ? "PREFERRED" : "REQUIRED")}
              title="Cliquer pour Obligatoire, re-cliquer pour Souhaité, à nouveau pour retirer"
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 12,
                border: `1px solid ${bordure}`,
                background: critere?.priorite === "REQUIRED" ? "#2c3e50" : critere?.priorite === "PREFERRED" ? "#eef2f7" : "#fff",
                color: critere?.priorite === "REQUIRED" ? "#fff" : "#333",
                cursor: "pointer",
              }}
            >
              {c}
              {critere ? (critere.priorite === "REQUIRED" ? " · Obligatoire" : " · Souhaité") : ""}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 10 }}>
        <Bouton onClick={onValider}>Voir mon besoin</Bouton>
      </div>
    </div>
  );
}

const LABEL_PRIORITE: Record<string, string> = { REQUIRED: "Obligatoire", PREFERRED: "Souhaité", OPTIONAL: "Bonus" };

function RevueBesoin({
  brouillon,
  onChange,
  onConfirmer,
  erreur,
  chargement,
}: {
  brouillon: RequirementStructure;
  onChange: (r: RequirementStructure) => void;
  onConfirmer: () => void;
  erreur: string | null;
  chargement: boolean;
}) {
  function retirerSkill(valeur: string) {
    onChange({ ...brouillon, skills: brouillon.skills.filter((s) => s.valeur !== valeur) });
  }

  return (
    <div style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 12 }}>
      <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>Besoin identifié — vérifiez avant de lancer le matching</p>
      <div style={{ fontSize: 12, color: grisTexte, display: "flex", flexDirection: "column", gap: 4 }}>
        <span>Expérience minimum : {brouillon.experienceMinAnnees != null ? `${brouillon.experienceMinAnnees} an(s)` : "non précisée"}</span>
        <span>Disponibilité : {brouillon.disponibilite ?? "non précisée"}</span>
        <span>Localisation : {brouillon.localisation ?? "non précisée"}</span>
        <div>
          Compétences :{" "}
          {brouillon.skills.length === 0 && "aucune"}
          {brouillon.skills.map((s) => (
            <span key={s.valeur} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 6 }}>
              <Badge variant={s.priorite === "REQUIRED" ? "warning" : "neutral"}>
                {s.valeur} ({LABEL_PRIORITE[s.priorite]})
              </Badge>
              <button onClick={() => retirerSkill(s.valeur)} style={{ fontSize: 10, border: "none", background: "none", cursor: "pointer", color: "#c0392b" }}>
                ✕
              </button>
            </span>
          ))}
        </div>
        {brouillon.champsInconnus.length > 0 && (
          <span style={{ color: "#aaa" }}>
            Non détecté (à compléter si pertinent) : {brouillon.champsInconnus.join(", ")}
          </span>
        )}
        <span style={{ color: "#aaa" }}>Source : {brouillon.provider === "anthropic" ? "analyse IA" : brouillon.provider === "local" ? "analyse simplifiée" : "critères choisis"}</span>
      </div>
      {erreur && <p style={{ color: "#c0392b", fontSize: 13, margin: "8px 0 0" }}>{erreur}</p>}
      <div style={{ marginTop: 10 }}>
        <Bouton onClick={onConfirmer} disabled={chargement}>
          {chargement ? "…" : "Confirmer et lancer le matching"}
        </Bouton>
      </div>
    </div>
  );
}

function CandidatCard({ candidat }: { candidat: CandidatAnonyme }) {
  return (
    <Card>
      <p style={{ margin: 0, fontWeight: 600 }}>{candidat.ingenieurId}</p>
      <p style={{ margin: "4px 0", fontSize: 12, color: grisTexte }}>
        {candidat.seniorite ?? "Séniorité non renseignée"}
        {candidat.anneesExperience != null ? ` · ${candidat.anneesExperience} an(s) d'expérience` : ""}
        {candidat.disponibilite ? ` · ${candidat.disponibilite}` : ""}
        {candidat.localisation ? ` · ${candidat.localisation}` : ""}
      </p>
      <p style={{ margin: "4px 0", fontSize: 12 }}>{candidat.explication}</p>
      {candidat.competencesCorrespondantes.length > 0 && (
        <p style={{ margin: "4px 0", fontSize: 11, color: "#2e7d32" }}>✓ {candidat.competencesCorrespondantes.join(" · ")}</p>
      )}
      {candidat.pointsAmeliorer.length > 0 && (
        <p style={{ margin: "4px 0", fontSize: 11, color: "#b8860b" }}>△ {candidat.pointsAmeliorer.join(" · ")}</p>
      )}
      {candidat.informationsManquantes.length > 0 && (
        <p style={{ margin: "4px 0", fontSize: 11, color: "#aaa" }}>? {candidat.informationsManquantes.join(" · ")}</p>
      )}
    </Card>
  );
}
