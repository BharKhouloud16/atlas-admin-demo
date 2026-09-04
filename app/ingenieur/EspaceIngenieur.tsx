"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DISPONIBILITES, STATUTS_EN_MISSION, MISSIONS_APRES, PREAVIS } from "@/lib/disponibilite";
import { PAYS, NATIONALITES, DEVISES, calculerRegimeSuggere } from "@/lib/localisation";
import { COMPETENCES_GROUPES } from "@/lib/competences";
import { bleu, bleuFonce, grisTexte, bordure } from "@/lib/theme";
import LogoAtlas from "@/components/LogoAtlas";
import BoutonDeconnexion from "@/components/BoutonDeconnexion";
import {
  type StatutCra,
  type JourCra,
  LABEL_STATUT_CRA,
  COULEUR_STATUT_CRA,
  craEstEditableParIngenieur,
  moisCourant,
  libelleMois,
  totauxDepuisDetail,
} from "@/lib/feuilles-de-temps";
import CalendrierCra from "@/components/CalendrierCra";
import { calculerBadgeConfiance } from "@/lib/scoring";
import type { Realisation } from "@/app/api/ingenieur/realisations/route";

type InfoCV = {
  id: string;
  categorie: string;
  libelle: string;
  valeur: string;
  ordre: number;
};

type Mission = {
  id: string;
  repere: string | null;
  statut: string;
  nbJours: number;
  createdAt: string;
  updatedAt: string;
  client: { nom: string; pays: string | null };
  evaluation: { note: number } | null;
};

type ProfilData = {
  nom: string;
  prenom: string | null;
  type: string | null;
  cvNomFichier: string | null;
  cvImporteLe: string | null;
  cvValide: boolean;
  disponibilite: string | null;
  disponibilitePrevue: string | null;
  changerMissionActuelle: boolean | null;
  missionApres: string | null;
  preavis: string | null;
  preavisPrecision: string | null;
  nationalite: string | null;
  nationalitePrecision: string | null;
  paysResidence: string | null;
  paysResidencePrecision: string | null;
  regimeSuggere: string | null;
  tjmSouhaite: number | null;
  tjmSouhaiteDevise: string | null;
  disponibiliteRenseigneeLe: string | null;
  questionnaireValide: boolean;
  competences: string[];
  entretiensRealises: number;
  realisations: Realisation[] | null;
  evaluationMoyenne: number | null;
  nombreEvaluations: number;
  missionsTerminees: number;
  createdAt: string;
  infosCv: InfoCV[];
  missions: Mission[];
};

const ONGLETS = ["Profil", "Historique de mission avec Atlas", "Documents", "Emploi du temps", "Mon compte"] as const;
type Onglet = (typeof ONGLETS)[number];

export default function EspaceIngenieur() {
  const [data, setData] = useState<ProfilData | null>(null);
  const [onglet, setOnglet] = useState<Onglet>("Profil");

  function recharger() {
    fetch("/api/ingenieur/profil")
      .then((r) => r.json())
      .then(setData);
  }

  useEffect(recharger, []);

  if (!data) {
    return <main style={{ maxWidth: 900, margin: "60px auto", padding: 24 }}>Chargement...</main>;
  }

  const missionActive = data.missions.some((m) => m.statut === "En cours");

  return (
    <>
      <header
        style={{
          background: "#fff",
          borderBottom: `1px solid ${bordure}`,
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LogoAtlas href="/ingenieur" />
          <span style={{ fontSize: 12, fontWeight: 600, color: grisTexte, borderLeft: `1px solid ${bordure}`, paddingLeft: 14 }}>
            Espace Ingénieur
          </span>
        </div>
        <BoutonDeconnexion />
      </header>
      <main style={{ maxWidth: 1000, margin: "40px auto", padding: "0 24px", display: "flex", gap: 32 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 22, margin: 0, color: bleuFonce }}>
              {data.prenom ? `${data.prenom} ${data.nom}` : data.nom}
            </h1>
            <StatutBadge data={data} missionActive={missionActive} />
            <BadgeConfianceIngenieur data={data} />
          </div>
          <p style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>Espace ingénieur</p>

          <Statistiques data={data} />

          {onglet === "Profil" && <OngletProfil data={data} recharger={recharger} />}
          {onglet === "Historique de mission avec Atlas" && (
            <OngletHistorique missions={data.missions} typeContrat={data.type} />
          )}
          {onglet === "Documents" && <OngletDocuments data={data} />}
          {onglet === "Emploi du temps" && <OngletEmploiDuTemps missionActive={missionActive} />}
          {onglet === "Mon compte" && <OngletCompte missionActive={missionActive} />}
        </div>

        <nav style={{ width: 220, flexShrink: 0 }}>
          <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {ONGLETS.map((o) => {
              const verrouille = o === "Emploi du temps" && !missionActive;
              return (
                <li key={o}>
                  <button
                    onClick={() => !verrouille && setOnglet(o)}
                    disabled={verrouille}
                    title={verrouille ? "Disponible dès que vous êtes en mission avec Atlas" : undefined}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid " + (onglet === o ? bleu : "#e4e7ee"),
                      background: onglet === o ? bleu : "#fff",
                      color: onglet === o ? "#fff" : verrouille ? "#aab0ba" : bleuFonce,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: verrouille ? "not-allowed" : "pointer",
                    }}
                  >
                    {o}
                    {verrouille && <span style={{ fontWeight: 400, fontSize: 11 }}> (verrouillé)</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </main>
    </>
  );
}

// Petit indicateur "lumineux" en haut du profil, résumant la situation de
// l'ingénieur d'un coup d'œil : en mission réelle avec Atlas (prioritaire),
// sinon d'après ses réponses au questionnaire de disponibilité.
function StatutBadge({ data, missionActive }: { data: ProfilData; missionActive: boolean }) {
  let label = "Non renseigné";
  let couleur = "#9aa0ab";

  if (missionActive) {
    label = "En mission avec Atlas";
    couleur = "#2563eb";
  } else if (data.disponibilite === "Disponible immédiatement") {
    label = "Disponible";
    couleur = "#16a34a";
  } else if (data.disponibilite === "En mission actuellement chez Atlas") {
    label = "En mission chez Atlas (déclaré)";
    couleur = "#2563eb";
  } else if (data.disponibilite === "En mission actuellement chez un autre client") {
    label = "En mission chez un autre client";
    couleur = "#7c3aed";
  } else if (data.disponibilite === "Non disponible immédiatement") {
    label = data.disponibilitePrevue ? `Non disponible (prévu : ${data.disponibilitePrevue})` : "Non disponible";
    couleur = "#dc2626";
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: couleur + "1a",
        border: `1px solid ${couleur}`,
        fontSize: 12,
        fontWeight: 600,
        color: couleur,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: couleur,
          boxShadow: `0 0 6px ${couleur}`,
        }}
      />
      {label}
    </span>
  );
}

// Badge de confiance calculé à partir des notes clients + missions menées à
// terme (voir lib/scoring.ts, calculerBadgeConfiance) — visible aussi côté
// Admin (/admin/profils). Volontairement calculé, jamais déclaré : motive
// l'ingénieur sans lui laisser la main dessus, comme un "Top Rated" Upwork.
function BadgeConfianceIngenieur({ data }: { data: ProfilData }) {
  const badge = calculerBadgeConfiance({
    evaluationMoyenne: data.evaluationMoyenne,
    nombreEvaluations: data.nombreEvaluations,
    missionsTerminees: data.missionsTerminees,
  });
  if (!badge) return null;
  return (
    <span
      title={badge.explication}
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: 999,
        color: badge.couleur,
        background: badge.couleur + "1a",
        border: `1px solid ${badge.couleur}`,
      }}
    >
      {badge.niveau === "confirme" ? "★ " : ""}
      {badge.label}
    </span>
  );
}

// Statistiques personnelles simples, façon "tableau de bord" — toujours
// visibles en haut de l'espace, quel que soit l'onglet sélectionné.
// Chiffres tirés des missions réellement enregistrées côté Atlas (pas des
// déclarations de l'ingénieur) + entretiensRealises, saisi par l'Admin.
function Statistiques({ data }: { data: ProfilData }) {
  const missionsValidees = data.missions.filter((m) => m.statut === "Terminée").length;
  const missionsEnCours = data.missions.filter((m) => m.statut === "En cours").length;
  const membreDepuis = new Date(data.createdAt);
  const moisAnciennete = Math.max(
    0,
    Math.floor((Date.now() - membreDepuis.getTime()) / (1000 * 60 * 60 * 24 * 30))
  );
  const anciennete =
    moisAnciennete < 1
      ? "Moins d'un mois"
      : moisAnciennete < 12
      ? `${moisAnciennete} mois`
      : `${Math.floor(moisAnciennete / 12)} an(s)`;

  const stats = [
    { label: "Missions terminées avec Atlas", valeur: String(missionsValidees) },
    { label: "Mission(s) en cours avec Atlas", valeur: String(missionsEnCours) },
    { label: "Entretiens réalisés (tous clients)", valeur: String(data.entretiensRealises) },
    {
      label: `Note client${data.nombreEvaluations > 1 ? "s" : ""} moyenne`,
      valeur: data.evaluationMoyenne != null ? `${data.evaluationMoyenne.toFixed(1)} / 5` : "Pas encore de note",
    },
    { label: "Compétences techniques cochées", valeur: String(data.competences.length) },
    { label: "Membre du vivier Atlas depuis", valeur: anciennete },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 24 }}>
      {stats.map((s) => (
        <div key={s.label} style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 12 }}>
          <p style={{ fontSize: 20, fontWeight: 700, margin: 0, color: bleuFonce }}>{s.valeur}</p>
          <p style={{ fontSize: 11, color: grisTexte, margin: "4px 0 0" }}>{s.label}</p>
        </div>
      ))}
    </div>
  );
}

function OngletProfil({ data, recharger }: { data: ProfilData; recharger: () => void }) {
  const categories = Array.from(new Set(data.infosCv.map((i) => i.categorie)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <Completude data={data} />

      <div>
        <p style={{ fontSize: 12, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
          Disponibilité &amp; localisation
        </p>
        <Disponibilite data={data} recharger={recharger} />
      </div>

      <div>
        <p style={{ fontSize: 12, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
          Réalisations
        </p>
        <RealisationsSection data={data} recharger={recharger} />
      </div>

      {categories.map((cat) => (
        <div key={cat}>
          <p style={{ fontSize: 12, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>{cat}</p>
          {cat === "experience" && (
            <p style={{ fontSize: 11, color: "#888", margin: "0 0 8px" }}>
              Expérience déclarée, extraite de votre CV — vos missions réalisées avec Atlas (vérifiées, notées par
              le client) sont listées séparément dans l&apos;onglet « Historique de mission avec Atlas ».
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.infosCv
              .filter((i) => i.categorie === cat)
              .map((info) => (
                <ChampEditable key={info.id} info={info} recharger={recharger} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const MAX_REALISATIONS = 10;

// Portfolio de réalisations concrètes, façon Malt : distinct de
// l'expérience déclarative du CV ci-dessus, met en avant jusqu'à 10
// réalisations (titre, description, lien optionnel) visibles par l'Admin
// dans /admin/profils (panneau de détail) pour convaincre un client. Le
// tableau entier est réédité et sauvegardé en un clic plutôt qu'un CRUD par
// élément (voir PUT /api/ingenieur/realisations).
function RealisationsSection({ data, recharger }: { data: ProfilData; recharger: () => void }) {
  const [realisations, setRealisations] = useState<Realisation[]>(data.realisations ?? []);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");
  const [modifie, setModifie] = useState(false);

  function ajouter() {
    if (realisations.length >= MAX_REALISATIONS) return;
    setRealisations((prev) => [...prev, { id: crypto.randomUUID(), titre: "", description: "", lien: null }]);
    setModifie(true);
  }

  function majItem(id: string, patch: Partial<Realisation>) {
    setRealisations((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setModifie(true);
  }

  function supprimer(id: string) {
    setRealisations((prev) => prev.filter((r) => r.id !== id));
    setModifie(true);
  }

  async function enregistrer() {
    setErreur("");
    const nettoyees = realisations.filter((r) => r.titre.trim());
    setEnvoi(true);
    const res = await fetch("/api/ingenieur/realisations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ realisations: nettoyees }),
    });
    setEnvoi(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErreur(d.error ?? "Erreur, réessayez.");
      return;
    }
    setModifie(false);
    recharger();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ fontSize: 12, color: "#888", margin: 0 }}>
        Jusqu&apos;à {MAX_REALISATIONS} réalisations concrètes (audit mené, migration pilotée, outil mis en place...)
        pour aider l&apos;Admin à vous proposer aux clients — visible uniquement en interne, pas sur un profil public.
      </p>
      {realisations.map((r) => (
        <div key={r.id} style={{ border: `1px solid ${bordure}`, borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            placeholder="Titre (ex. Audit de sécurité API pour un client bancaire)"
            value={r.titre}
            onChange={(e) => majItem(r.id, { titre: e.target.value })}
            maxLength={100}
            style={{ padding: 6, fontSize: 13, border: `1px solid ${bordure}`, borderRadius: 6 }}
          />
          <textarea
            placeholder="Description courte (contexte, résultat, technos utilisées)"
            value={r.description}
            onChange={(e) => majItem(r.id, { description: e.target.value })}
            maxLength={600}
            rows={2}
            style={{ padding: 6, fontSize: 13, fontFamily: "inherit", border: `1px solid ${bordure}`, borderRadius: 6 }}
          />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              placeholder="Lien (facultatif, https://...)"
              value={r.lien ?? ""}
              onChange={(e) => majItem(r.id, { lien: e.target.value || null })}
              maxLength={300}
              style={{ flex: 1, padding: 6, fontSize: 13, border: `1px solid ${bordure}`, borderRadius: 6 }}
            />
            <button onClick={() => supprimer(r.id)} style={{ fontSize: 12, padding: "5px 10px" }}>
              Supprimer
            </button>
          </div>
        </div>
      ))}
      {erreur && <p style={{ color: "crimson", fontSize: 13, margin: 0 }}>{erreur}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        {realisations.length < MAX_REALISATIONS && (
          <button onClick={ajouter} style={{ fontSize: 12, padding: "6px 12px" }}>
            + Ajouter une réalisation
          </button>
        )}
        {modifie && (
          <button
            onClick={enregistrer}
            disabled={envoi}
            style={{ fontSize: 12, padding: "6px 12px", background: bleu, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
          >
            {envoi ? "Enregistrement..." : "Enregistrer les réalisations"}
          </button>
        )}
      </div>
    </div>
  );
}

// Indicateur de complétude du profil, façon "profil LinkedIn" : motive
// l'ingénieur à finir de renseigner son dossier (compétences en particulier,
// facultatives mais très utiles pour le matching côté Admin — voir
// lib/scoring.ts et /admin/profils). Purement informatif, ne bloque rien.
function Completude({ data }: { data: ProfilData }) {
  const etapes = [
    { label: "CV importé et validé", fait: data.cvValide },
    { label: "Disponibilité & localisation renseignées", fait: data.questionnaireValide },
    { label: "Compétences techniques renseignées", fait: data.competences.length > 0 },
  ];
  const nbFaites = etapes.filter((e) => e.fait).length;
  const pourcentage = Math.round((nbFaites / etapes.length) * 100);
  if (pourcentage === 100) return null;

  const couleur = pourcentage >= 66 ? "#d97706" : "#dc2626";

  return (
    <div style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Profil complété à {pourcentage}%</p>
        <span style={{ fontSize: 12, color: couleur, fontWeight: 600 }}>
          {etapes.length - nbFaites} étape(s) restante(s)
        </span>
      </div>
      <div style={{ background: "#f0f0f0", borderRadius: 4, height: 8, overflow: "hidden", marginBottom: 10 }}>
        <div style={{ width: `${pourcentage}%`, background: couleur, height: "100%", transition: "width 0.3s" }} />
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
        {etapes.map((e) => (
          <li key={e.label} style={{ fontSize: 12, color: e.fait ? "#16a34a" : "#4b5567" }}>
            {e.fait ? "✓ " : "○ "}
            {e.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

const OPTIONS_SENIORITE = ["Junior", "Confirmé", "Senior", "Expert"];

// Champs extraits du CV dont la valeur est une liste (compétences, langues) :
// affichés ligne par ligne plutôt qu'en bloc de texte, avec un rappel que ces
// libellés viennent tels quels du CV — à distinguer des compétences à cocher
// (section Disponibilité & localisation ci-dessus), utilisées pour le matching.
const CHAMPS_LISTE = [
  "Compétences techniques principales",
  "Compétences secondaires / outils",
  "Langues parlées",
];

function ChampEditable({ info, recharger }: { info: InfoCV; recharger: () => void }) {
  const [edition, setEdition] = useState(false);
  const [valeur, setValeur] = useState(info.valeur);
  const [envoi, setEnvoi] = useState(false);

  const estSeniorite = info.libelle.startsWith("Séniorité");
  const estListe = CHAMPS_LISTE.includes(info.libelle);
  const elements = estListe
    ? info.valeur.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean)
    : [];

  async function enregistrer() {
    setEnvoi(true);
    await fetch("/api/ingenieur/cv/infos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: info.id, valeur }),
    });
    setEnvoi(false);
    setEdition(false);
    recharger();
  }

  return (
    <div style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 12 }}>
      <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{info.libelle}</p>
      {estListe && !edition && (
        <p style={{ fontSize: 11, color: "#aab0ba", margin: "0 0 6px" }}>
          Extrait tel quel de votre CV — pour les compétences utilisées dans le matching, voir la liste à cocher
          ci-dessus.
        </p>
      )}
      {edition ? (
        estSeniorite ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={OPTIONS_SENIORITE.includes(valeur) ? valeur : ""}
              onChange={(e) => setValeur(e.target.value)}
              style={{ flex: 1, padding: 6, border: "1px solid #e4e7ee", borderRadius: 6, fontFamily: "inherit", fontSize: 14 }}
            >
              <option value="">Sélectionnez...</option>
              {OPTIONS_SENIORITE.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <button onClick={enregistrer} disabled={envoi} style={{ padding: "6px 12px", fontSize: 13 }}>
              {envoi ? "..." : "Enregistrer"}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <textarea
              value={valeur}
              onChange={(e) => setValeur(e.target.value)}
              rows={2}
              style={{ flex: 1, padding: 6, border: "1px solid #e4e7ee", borderRadius: 6, fontFamily: "inherit", fontSize: 14 }}
            />
            <button onClick={enregistrer} disabled={envoi} style={{ padding: "6px 12px", fontSize: 13 }}>
              {envoi ? "..." : "Enregistrer"}
            </button>
          </div>
        )
      ) : estListe && elements.length > 0 ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <ul style={{ margin: 0, paddingLeft: 18, flex: 1 }}>
            {elements.map((el, i) => (
              <li key={i} style={{ fontSize: 14 }}>
                {el}
              </li>
            ))}
          </ul>
          <button onClick={() => setEdition(true)} style={{ fontSize: 12, padding: "4px 10px", flexShrink: 0 }}>
            Modifier
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <p style={{ fontSize: 14, margin: 0 }}>{info.valeur || "—"}</p>
          <button onClick={() => setEdition(true)} style={{ fontSize: 12, padding: "4px 10px", flexShrink: 0 }}>
            Modifier
          </button>
        </div>
      )}
    </div>
  );
}

function Disponibilite({ data, recharger }: { data: ProfilData; recharger: () => void }) {
  const [edition, setEdition] = useState(false);
  const [disponibilite, setDisponibilite] = useState(data.disponibilite ?? "");
  const [disponibilitePrevue, setDisponibilitePrevue] = useState(data.disponibilitePrevue ?? "");
  const [changerMissionActuelle, setChangerMissionActuelle] = useState(
    data.changerMissionActuelle === true ? "oui" : data.changerMissionActuelle === false ? "non" : ""
  );
  const [missionApres, setMissionApres] = useState(data.missionApres ?? "");
  const [preavis, setPreavis] = useState(data.preavis ?? "");
  const [preavisPrecision, setPreavisPrecision] = useState(data.preavisPrecision ?? "");
  const [nationalite, setNationalite] = useState(data.nationalite ?? "");
  const [nationalitePrecision, setNationalitePrecision] = useState(data.nationalitePrecision ?? "");
  const [paysResidence, setPaysResidence] = useState(data.paysResidence ?? "");
  const [paysResidencePrecision, setPaysResidencePrecision] = useState(data.paysResidencePrecision ?? "");
  const [tjmSouhaite, setTjmSouhaite] = useState(data.tjmSouhaite != null ? String(data.tjmSouhaite) : "");
  const [tjmSouhaiteDevise, setTjmSouhaiteDevise] = useState(data.tjmSouhaiteDevise ?? "EUR");
  const [competences, setCompetences] = useState<string[]>(data.competences ?? []);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");

  function basculerCompetence(c: string) {
    setCompetences((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  const enMission = STATUTS_EN_MISSION.includes(disponibilite);
  const nonDisponible = disponibilite === "Non disponible immédiatement";
  const regimeApercu = calculerRegimeSuggere(paysResidence, nationalite);

  async function enregistrer() {
    setErreur("");
    setEnvoi(true);
    const res = await fetch("/api/ingenieur/disponibilite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        disponibilite,
        disponibilitePrevue: nonDisponible ? disponibilitePrevue : undefined,
        changerMissionActuelle: enMission ? changerMissionActuelle === "oui" : undefined,
        missionApres: enMission ? missionApres : undefined,
        preavis,
        preavisPrecision,
        nationalite,
        nationalitePrecision,
        paysResidence,
        paysResidencePrecision,
        tjmSouhaite: Number(tjmSouhaite),
        tjmSouhaiteDevise,
        competences,
      }),
    });
    setEnvoi(false);
    if (!res.ok) {
      const d = await res.json();
      setErreur(d.error ?? "Erreur.");
      return;
    }
    setEdition(false);
    recharger();
  }

  if (!edition) {
    return (
      <div style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <Ligne label="Statut" valeur={data.disponibilite} />
        {data.disponibilite === "Non disponible immédiatement" && (
          <Ligne label="Prévision de disponibilité" valeur={data.disponibilitePrevue} />
        )}
        {STATUTS_EN_MISSION.includes(data.disponibilite ?? "") && (
          <>
            <Ligne label="Souhaite changer" valeur={data.changerMissionActuelle ? "Oui" : "Non"} />
            <Ligne label="Après la mission" valeur={data.missionApres} />
          </>
        )}
        <Ligne label="Préavis" valeur={data.preavis === "Autre" ? data.preavisPrecision : data.preavis} />
        <Ligne label="Nationalité" valeur={data.nationalite === "Autre" ? data.nationalitePrecision : data.nationalite} />
        <Ligne label="Pays de résidence" valeur={data.paysResidence === "Autre" ? data.paysResidencePrecision : data.paysResidence} />
        <Ligne
          label="Prétention salariale (TJM souhaité)"
          valeur={data.tjmSouhaite != null ? `${data.tjmSouhaite} ${data.tjmSouhaiteDevise ?? ""}`.trim() : null}
        />
        <div>
          <span style={{ fontSize: 14, color: "#888" }}>Compétences techniques : </span>
          {data.competences.length === 0 ? (
            <span style={{ fontSize: 14 }}>—</span>
          ) : (
            <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
              {data.competences.map((c) => (
                <span
                  key={c}
                  style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#f0f2f6", color: "#4b5567" }}
                >
                  {c}
                </span>
              ))}
            </span>
          )}
        </div>
        {data.regimeSuggere && (
          <p style={{ fontSize: 13, color: "#4b5567", margin: "4px 0 0", background: "#f6f7fa", padding: 8, borderRadius: 6 }}>
            <strong>Profil suggéré : </strong>
            {data.regimeSuggere}
          </p>
        )}
        <div>
          <button onClick={() => setEdition(true)} style={{ fontSize: 12, padding: "4px 10px" }}>
            Modifier
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Statut</p>
        <select value={disponibilite} onChange={(e) => setDisponibilite(e.target.value)} style={{ width: "100%", padding: 6 }}>
          <option value="">Sélectionnez...</option>
          {DISPONIBILITES.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
      {nonDisponible && (
        <div>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Prévision de disponibilité</p>
          <input
            type="text"
            placeholder="Ex : disponible à partir du 15 octobre, dans 2 mois..."
            value={disponibilitePrevue}
            onChange={(e) => setDisponibilitePrevue(e.target.value)}
            style={{ width: "100%", padding: 6 }}
          />
        </div>
      )}
      {enMission && (
        <>
          <div>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Souhaite changer</p>
            <select value={changerMissionActuelle} onChange={(e) => setChangerMissionActuelle(e.target.value)} style={{ width: "100%", padding: 6 }}>
              <option value="">Sélectionnez...</option>
              <option value="oui">Oui</option>
              <option value="non">Non</option>
            </select>
          </div>
          <div>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Après la mission</p>
            <select value={missionApres} onChange={(e) => setMissionApres(e.target.value)} style={{ width: "100%", padding: 6 }}>
              <option value="">Sélectionnez...</option>
              {MISSIONS_APRES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      <div>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Préavis</p>
        <select value={preavis} onChange={(e) => setPreavis(e.target.value)} style={{ width: "100%", padding: 6 }}>
          <option value="">Sélectionnez...</option>
          {PREAVIS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {preavis === "Autre" && (
          <input
            type="text"
            value={preavisPrecision}
            onChange={(e) => setPreavisPrecision(e.target.value)}
            style={{ width: "100%", padding: 6, marginTop: 6 }}
          />
        )}
      </div>
      <div>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Nationalité</p>
        <select value={nationalite} onChange={(e) => setNationalite(e.target.value)} style={{ width: "100%", padding: 6 }}>
          <option value="">Sélectionnez...</option>
          {NATIONALITES.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {nationalite === "Autre" && (
          <input
            type="text"
            value={nationalitePrecision}
            onChange={(e) => setNationalitePrecision(e.target.value)}
            style={{ width: "100%", padding: 6, marginTop: 6 }}
          />
        )}
      </div>
      <div>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Pays de résidence</p>
        <select value={paysResidence} onChange={(e) => setPaysResidence(e.target.value)} style={{ width: "100%", padding: 6 }}>
          <option value="">Sélectionnez...</option>
          {PAYS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {paysResidence === "Autre" && (
          <input
            type="text"
            value={paysResidencePrecision}
            onChange={(e) => setPaysResidencePrecision(e.target.value)}
            style={{ width: "100%", padding: 6, marginTop: 6 }}
          />
        )}
        {regimeApercu && (
          <p style={{ fontSize: 12, color: "#4b5567", marginTop: 8, background: "#f6f7fa", padding: 8, borderRadius: 6 }}>
            <strong>Profil suggéré :</strong> {regimeApercu}
          </p>
        )}
      </div>
      <div>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Compétences techniques</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {COMPETENCES_GROUPES.map((groupe) => (
            <div key={groupe.categorie}>
              <p style={{ fontSize: 11, textTransform: "uppercase", color: "#aab0ba", marginBottom: 4 }}>
                {groupe.categorie}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {groupe.competences.map((c) => {
                  const actif = competences.includes(c);
                  return (
                    <button
                      type="button"
                      key={c}
                      onClick={() => basculerCompetence(c)}
                      style={{
                        fontSize: 12,
                        padding: "5px 10px",
                        borderRadius: 999,
                        border: "1px solid " + (actif ? bleu : "#e4e7ee"),
                        background: actif ? bleu : "#fff",
                        color: actif ? "#fff" : "#4b5567",
                        cursor: "pointer",
                      }}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Prétention salariale (TJM souhaité)</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="number"
            min={0}
            value={tjmSouhaite}
            onChange={(e) => setTjmSouhaite(e.target.value)}
            style={{ flex: 1, padding: 6 }}
          />
          <select value={tjmSouhaiteDevise} onChange={(e) => setTjmSouhaiteDevise(e.target.value)} style={{ padding: 6 }}>
            {DEVISES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>
      {erreur && <p style={{ color: "crimson", fontSize: 13 }}>{erreur}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={enregistrer} disabled={envoi} style={{ padding: "6px 14px", fontSize: 13 }}>
          {envoi ? "..." : "Enregistrer"}
        </button>
        <button onClick={() => setEdition(false)} style={{ padding: "6px 14px", fontSize: 13 }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

function Ligne({ label, valeur }: { label: string; valeur: string | null | undefined }) {
  return (
    <p style={{ fontSize: 14, margin: 0 }}>
      <span style={{ color: "#888" }}>{label} : </span>
      {valeur || "—"}
    </p>
  );
}

const LABEL_TYPE_CONTRAT: Record<string, string> = {
  SALARIE: "Salarié",
  FREELANCE: "Freelance",
  PORTAGE: "Portage salarial",
};

function OngletHistorique({ missions, typeContrat }: { missions: Mission[]; typeContrat: string | null }) {
  if (missions.length === 0) {
    return (
      <p style={{ fontSize: 14, color: "#4b5567" }}>
        Aucune mission avec Atlas Quality Partners pour l'instant. Votre historique apparaîtra ici dès votre
        première mission.
      </p>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #e4e7ee" }}>
            <th style={{ padding: "6px 8px" }}>Client</th>
            <th style={{ padding: "6px 8px" }}>Mission</th>
            <th style={{ padding: "6px 8px" }}>Localisation client</th>
            <th style={{ padding: "6px 8px" }}>Type de contrat</th>
            <th style={{ padding: "6px 8px" }}>Statut</th>
            <th style={{ padding: "6px 8px" }}>Début</th>
            <th style={{ padding: "6px 8px" }}>Fin (ou prévisionnelle)</th>
            <th style={{ padding: "6px 8px" }}>Jours</th>
            <th style={{ padding: "6px 8px" }}>Évaluation client</th>
          </tr>
        </thead>
        <tbody>
          {missions.map((m) => (
            <tr key={m.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td style={{ padding: "6px 8px", fontWeight: 600 }}>{m.client.nom}</td>
              <td style={{ padding: "6px 8px" }}>{m.repere ?? "—"}</td>
              <td style={{ padding: "6px 8px" }}>{m.client.pays ?? "—"}</td>
              <td style={{ padding: "6px 8px" }}>{typeContrat ? LABEL_TYPE_CONTRAT[typeContrat] ?? typeContrat : "—"}</td>
              <td style={{ padding: "6px 8px" }}>
                {m.statut}
                {m.statut === "Terminée" && (
                  <span
                    title="Mission menée à terme avec Atlas Quality Partners, historique vérifié — à distinguer de l'expérience déclarée depuis le CV"
                    style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: "#16a34a" }}
                  >
                    ✓ vérifiée Atlas
                  </span>
                )}
              </td>
              <td style={{ padding: "6px 8px" }}>{new Date(m.createdAt).toLocaleDateString("fr-FR")}</td>
              <td style={{ padding: "6px 8px" }}>
                {m.statut === "En cours" ? "En cours" : new Date(m.updatedAt).toLocaleDateString("fr-FR")}
              </td>
              <td style={{ padding: "6px 8px" }}>{m.nbJours}</td>
              <td style={{ padding: "6px 8px" }}>
                {m.evaluation ? (
                  <span title={`${m.evaluation.note}/5`} style={{ color: "#d97706", letterSpacing: 1 }}>
                    {"★".repeat(m.evaluation.note)}
                    <span style={{ color: "#ddd" }}>{"★".repeat(5 - m.evaluation.note)}</span>
                  </span>
                ) : (
                  <span style={{ color: "#aaa" }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OngletDocuments({ data }: { data: ProfilData }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {data.cvNomFichier ? (
        <div style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>{data.cvNomFichier}</p>
            <p style={{ fontSize: 13, color: "#888", margin: "4px 0 0" }}>
              CV — importé le {data.cvImporteLe ? new Date(data.cvImporteLe).toLocaleDateString("fr-FR") : "—"}
            </p>
          </div>
          <a href="/api/ingenieur/cv/fichier" target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
            Ouvrir
          </a>
        </div>
      ) : (
        <p style={{ fontSize: 14, color: "#4b5567" }}>Aucun document pour l'instant.</p>
      )}
      <p style={{ fontSize: 13, color: "#888" }}>
        Les contrats, rapports et factures liés à vos missions apparaîtront ici au fur et à mesure.
      </p>
    </div>
  );
}

// Gestion du compte par l'ingénieur lui-même : désactivation temporaire
// (réversible, voir /ingenieur/compte-desactive) ou suppression définitive
// du profil (voir app/api/ingenieur/compte/route.ts).
function OngletCompte({ missionActive }: { missionActive: boolean }) {
  const router = useRouter();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");
  const [confirmationDesactivation, setConfirmationDesactivation] = useState(false);
  const [confirmationSuppression, setConfirmationSuppression] = useState(false);

  async function desactiver() {
    setErreur("");
    setEnvoi(true);
    const res = await fetch("/api/ingenieur/compte/desactiver", { method: "POST" });
    setEnvoi(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErreur(d.error ?? "Erreur, réessayez.");
      return;
    }
    router.push("/connexion?desactive=1");
  }

  async function supprimer() {
    setErreur("");
    setEnvoi(true);
    const res = await fetch("/api/ingenieur/compte", { method: "DELETE" });
    setEnvoi(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErreur(d.error ?? "Erreur, réessayez.");
      return;
    }
    router.push("/connexion?supprime=1");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 520 }}>
      {erreur && <p style={{ color: "crimson", fontSize: 13 }}>{erreur}</p>}

      <ChangementMotDePasse />

      <p style={{ fontSize: 12, color: "#888" }}>
        Pour savoir comment vos données sont utilisées et exercer vos droits (accès, rectification, portabilité...),
        consultez notre{" "}
        <a href="/confidentialite" target="_blank" rel="noreferrer" style={{ color: bleu }}>
          politique de confidentialité
        </a>
        .
      </p>

      <div style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 16 }}>
        <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 8px" }}>Désactiver temporairement mon profil</p>
        <p style={{ fontSize: 13, color: "#888", margin: "0 0 12px" }}>
          Votre profil devient invisible et vous serez déconnecté(e). Vous pourrez le réactiver à tout moment en
          vous reconnectant avec vos identifiants habituels.
        </p>
        {!confirmationDesactivation ? (
          <button onClick={() => setConfirmationDesactivation(true)} style={{ padding: "8px 16px", fontSize: 13 }}>
            Désactiver mon profil
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 13, margin: 0 }}>Confirmez : vous serez immédiatement déconnecté(e).</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={desactiver} disabled={envoi} style={{ padding: "8px 16px", fontSize: 13 }}>
                {envoi ? "..." : "Oui, désactiver"}
              </button>
              <button onClick={() => setConfirmationDesactivation(false)} style={{ padding: "8px 16px", fontSize: 13 }}>
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ border: "1px solid #f3d2d2", borderRadius: 8, padding: 16 }}>
        <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 8px", color: "#b3261e" }}>
          Supprimer définitivement mon profil
        </p>
        <p style={{ fontSize: 13, color: "#888", margin: "0 0 12px" }}>
          Action irréversible : votre profil, votre CV et vos informations seront définitivement supprimés.
          {missionActive &&
            " Vous avez une mission en cours avec Atlas : la suppression n'est possible qu'après clôture de celle-ci (contactez l'administrateur)."}
        </p>
        {!confirmationSuppression ? (
          <button
            onClick={() => setConfirmationSuppression(true)}
            style={{ padding: "8px 16px", fontSize: 13, color: "#b3261e", borderColor: "#b3261e" }}
          >
            Supprimer définitivement
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 13, margin: 0 }}>Êtes-vous certain(e) ? Cette action est définitive.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={supprimer}
                disabled={envoi}
                style={{ padding: "8px 16px", fontSize: 13, background: "#b3261e", color: "#fff", border: "none", borderRadius: 6 }}
              >
                {envoi ? "..." : "Oui, tout supprimer"}
              </button>
              <button onClick={() => setConfirmationSuppression(false)} style={{ padding: "8px 16px", fontSize: 13 }}>
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Changement de mot de passe, avec confirmation double (ancien + nouveau +
// confirmation du nouveau) puis un message de confirmation finale avant
// l'envoi, comme demandé — pas de vraie vérification anti-robot en démo,
// juste une case à cocher symbolique.
function ChangementMotDePasse() {
  const [ancien, setAncien] = useState("");
  const [nouveau, setNouveau] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pasUnRobot, setPasUnRobot] = useState(false);
  const [demandeConfirmation, setDemandeConfirmation] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");
  const [succes, setSucces] = useState(false);

  function validerAvantConfirmation(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    setSucces(false);
    if (nouveau.length < 8) {
      setErreur("Le nouveau mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (nouveau !== confirmation) {
      setErreur("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (!pasUnRobot) {
      setErreur("Merci de cocher la case de vérification.");
      return;
    }
    setDemandeConfirmation(true);
  }

  async function confirmer() {
    setEnvoi(true);
    setErreur("");
    const res = await fetch("/api/auth/mot-de-passe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ancienMotDePasse: ancien,
        nouveauMotDePasse: nouveau,
        confirmationNouveauMotDePasse: confirmation,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setEnvoi(false);
    setDemandeConfirmation(false);
    if (!res.ok) {
      setErreur(d.error ?? "Erreur, réessayez.");
      return;
    }
    setAncien("");
    setNouveau("");
    setConfirmation("");
    setPasUnRobot(false);
    setSucces(true);
  }

  return (
    <div style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 16 }}>
      <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 12px" }}>Modifier mon mot de passe</p>

      {succes && (
        <p style={{ fontSize: 13, color: "#16a34a", background: "#eafaf0", padding: 8, borderRadius: 6, marginBottom: 12 }}>
          Mot de passe modifié avec succès.
        </p>
      )}
      {erreur && <p style={{ color: "crimson", fontSize: 13, marginBottom: 12 }}>{erreur}</p>}

      {demandeConfirmation ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 13, margin: 0 }}>Voulez-vous confirmer la modification de votre mot de passe ?</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={confirmer} disabled={envoi} style={{ padding: "8px 16px", fontSize: 13 }}>
              {envoi ? "..." : "Confirmer"}
            </button>
            <button onClick={() => setDemandeConfirmation(false)} style={{ padding: "8px 16px", fontSize: 13 }}>
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={validerAvantConfirmation} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="password"
            placeholder="Ancien mot de passe"
            value={ancien}
            onChange={(e) => setAncien(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Nouveau mot de passe (8 caractères min.)"
            value={nouveau}
            onChange={(e) => setNouveau(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Confirmer le nouveau mot de passe"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#4b5567" }}>
            <input type="checkbox" checked={pasUnRobot} onChange={(e) => setPasUnRobot(e.target.checked)} />
            Je ne suis pas un robot
          </label>
          <div>
            <button type="submit" style={{ padding: "8px 16px", fontSize: 13 }}>
              Modifier mon mot de passe
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

type MissionCra = { id: string; repere: string | null; statut: string; client: { nom: string; pays: string | null } };
type FeuilleCra = {
  id: string;
  mois: string;
  joursTravailles: number;
  heuresSupplementaires: number;
  commentaire: string | null;
  detailJours: JourCra[] | null;
  statut: StatutCra;
  motifRejet: string | null;
  mission: { id: string; repere: string | null; client: { nom: string } };
};

// Compte-rendu d'activité (CRA) mensuel, façon BoondManager/portage salarial :
// jours travaillés + heures sup déclarés par mission et par mois, puis
// circuit de validation Admin -> Client avant facturation (voir
// app/api/feuilles-de-temps et lib/feuilles-de-temps.ts).
function OngletEmploiDuTemps({ missionActive }: { missionActive: boolean }) {
  const [missions, setMissions] = useState<MissionCra[]>([]);
  const [feuilles, setFeuilles] = useState<FeuilleCra[]>([]);
  const [chargement, setChargement] = useState(true);

  function recharger() {
    fetch("/api/feuilles-de-temps")
      .then((r) => r.json())
      .then((data) => {
        setMissions(data.missions ?? []);
        setFeuilles(data.feuilles ?? []);
        setChargement(false);
      });
  }
  useEffect(recharger, []);

  if (!missionActive) {
    return (
      <p style={{ fontSize: 14, color: "#4b5567" }}>
        Cette rubrique s'active dès que vous êtes en mission avec Atlas Quality Partners. Vous pourrez alors
        déclarer vos jours travaillés et vos heures supplémentaires, pour validation par l'administrateur puis
        par le client, avant facturation.
      </p>
    );
  }
  if (chargement) return <p style={{ fontSize: 14, color: "#888" }}>Chargement...</p>;

  const missionsEnCours = missions.filter((m) => m.statut === "En cours");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {missionsEnCours.map((m) => (
        <FormulaireCra key={m.id} mission={m} feuilles={feuilles.filter((f) => f.mission.id === m.id)} recharger={recharger} />
      ))}

      {feuilles.length > 0 && (
        <div>
          <p style={{ fontSize: 12, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>Historique</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {feuilles.map((f) => (
              <div key={f.id} style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                    {libelleMois(f.mois)} — {f.mission.client.nom}
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#888" }}>
                    {f.joursTravailles} j{f.heuresSupplementaires > 0 ? ` · ${f.heuresSupplementaires} h sup` : ""}
                    {f.statut === "Rejetee" && f.motifRejet ? ` · Motif : ${f.motifRejet}` : ""}
                  </p>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "3px 8px",
                    borderRadius: 999,
                    color: COULEUR_STATUT_CRA[f.statut],
                    background: COULEUR_STATUT_CRA[f.statut] + "1a",
                    whiteSpace: "nowrap",
                  }}
                >
                  {LABEL_STATUT_CRA[f.statut]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FormulaireCra({
  mission,
  feuilles,
  recharger,
}: {
  mission: MissionCra;
  feuilles: FeuilleCra[];
  recharger: () => void;
}) {
  const [mois, setMois] = useState(moisCourant());
  const existante = feuilles.find((f) => f.mois === mois);
  const [detail, setDetail] = useState<JourCra[]>([]);
  const [commentaire, setCommentaire] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    setDetail(existante?.detailJours ?? []);
    setCommentaire(existante?.commentaire ?? "");
    setErreur("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mois, existante?.id]);

  const editable = !existante || craEstEditableParIngenieur(existante.statut);
  const { joursTravailles, heuresSupplementaires } = totauxDepuisDetail(detail);

  async function enregistrer(soumettre: boolean) {
    setErreur("");
    setEnvoi(true);
    const res = await fetch("/api/feuilles-de-temps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        missionId: mission.id,
        mois,
        detailJours: detail,
        commentaire,
        soumettre,
      }),
    });
    setEnvoi(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErreur(d.error ?? "Erreur, réessayez.");
      return;
    }
    recharger();
  }

  return (
    <div style={{ border: "1px solid #e4e7ee", borderRadius: 8, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 4px" }}>
          {mission.repere ?? mission.client.nom} — {mission.client.nom}
        </p>
        <div>
          <input
            type="month"
            value={mois}
            onChange={(e) => setMois(e.target.value)}
            style={{ padding: 6, border: `1px solid ${bordure}`, borderRadius: 6 }}
          />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <CalendrierCra
          mois={mois}
          paysClient={mission.client.pays}
          detail={detail}
          editable={editable}
          onChange={setDetail}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Commentaire (facultatif)</p>
        <textarea
          value={commentaire}
          onChange={(e) => setCommentaire(e.target.value)}
          disabled={!editable}
          rows={2}
          style={{ width: "100%", padding: 6, fontFamily: "inherit" }}
        />
      </div>

      {existante && !editable && (
        <p style={{ fontSize: 12, color: COULEUR_STATUT_CRA[existante.statut], marginTop: 10 }}>
          {LABEL_STATUT_CRA[existante.statut]}
        </p>
      )}
      {existante?.statut === "Rejetee" && existante.motifRejet && (
        <p style={{ fontSize: 12, color: "#dc2626", marginTop: 4 }}>Motif du rejet : {existante.motifRejet}</p>
      )}
      {erreur && <p style={{ color: "crimson", fontSize: 13, marginTop: 8 }}>{erreur}</p>}

      {editable && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={() => enregistrer(false)}
            disabled={envoi || joursTravailles === 0}
            style={{ padding: "6px 14px", fontSize: 13 }}
          >
            {envoi ? "..." : "Enregistrer le brouillon"}
          </button>
          <button
            onClick={() => enregistrer(true)}
            disabled={envoi || joursTravailles === 0}
            style={{ padding: "6px 14px", fontSize: 13, background: bleu, color: "#fff", border: "none", borderRadius: 6 }}
          >
            {envoi ? "..." : "Soumettre pour validation"}
          </button>
        </div>
      )}
    </div>
  );
}
