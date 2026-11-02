"use client";

import { useEffect, useState } from "react";
import { grisTexte, bleuFonce } from "@/lib/theme";
import { Card, Section, EmptyState, Badge, Bouton, Tabs, type BadgeVariant } from "@/components/client/primitives";
import { PAYS } from "@/lib/localisation";
import type { Completude } from "@/lib/client-profile/completude";

// COMPANY ATLAS — LOT 4 : Profil Client Intelligence Foundation (15/09/2026).
//
// Remplace le "Bientôt disponible" de la rubrique "Entreprise" (LOT 1).
// Représentation DURABLE du client — distincte de /client/besoins
// (ClientNeed, "de quoi ce client a besoin maintenant"). Historique des
// faits intégralement additif côté données (lib/client-profile/faits.ts,
// instancesActivesParCle) — seules les instances ACTIVES sont affichées
// ici, jamais l'historique technique complet.

type Client = {
  id: string;
  nom: string;
  pays: string | null;
  secteur: string | null;
  contactReferent: string | null;
  email: string | null;
  telephone: string | null;
  identifiantEntreprise: string | null;
  formeJuridique: string | null;
  adresseSiege: string | null;
  adresseFacturation: string | null;
  identifiantFiscal: string | null;
  siteWeb: string | null;
  fonctionContact: string | null;
  contactFacturationNom: string | null;
  contactFacturationEmail: string | null;
};

type Fait = {
  id: string;
  cle: string;
  valeur: string;
  statut: "VERIFIE" | "DECLARE" | "INFERE" | "OBSERVE" | "INCONNU";
  source: string | null;
  confirmeDepuis: string | null;
  createdAt: string;
};

type Besoin = { id: string; titre: string | null; texteOriginal: string; statut: string; createdAt: string };

type SignalRecurrence = { cle: string; valeur: string; occurrences: number; needIds: string[] };

type SignalResultatMission = {
  cle: "CRITERE_REUSSITE_DURABLE";
  valeur: string;
  noteMoyenne: number;
  occurrences: number;
  missionIds: string[];
};

type ProfilData = {
  client: Client;
  completude: Completude;
  profile: { id: string; createdAt: string; updatedAt: string };
  faits: Fait[];
  besoins: { total: number; ouverts: number; recents: Besoin[] };
  resultats: { missionsRealisees: number; noteMoyenne: number | null; nombreEvaluations: number };
  signauxRecurrence: SignalRecurrence[];
  signalResultatMission: SignalResultatMission | null;
};

const CLES_SINGLETON = new Set(["CONTEXTE_ACTIVITE"]);

const LABEL_CLE: Record<string, string> = {
  CONTEXTE_ACTIVITE: "Contexte d'activité",
  ENJEU: "Enjeu",
  OBJECTIF_DURABLE: "Objectif",
  PRIORITE_DURABLE: "Priorité",
  CONTRAINTE_DURABLE: "Contrainte",
  PREFERENCE_DURABLE: "Préférence",
  CRITERE_REUSSITE_DURABLE: "Critère de réussite",
  RISQUE_DURABLE: "Risque",
  BESOIN_RECURRENT_CONFIRME: "Besoin récurrent",
};

const LABEL_PROVENANCE: Record<string, string> = {
  VERIFIE: "Confirmé par vous",
  DECLARE: "Déclaré par vous",
  INFERE: "Déduit par ATLAS",
  OBSERVE: "Observé dans votre activité",
  INCONNU: "À préciser",
};

const VARIANT_PROVENANCE: Record<string, BadgeVariant> = {
  VERIFIE: "success",
  DECLARE: "info",
  INFERE: "neutral",
  OBSERVE: "neutral",
  INCONNU: "warning",
};

const LABEL_STATUT_BESOIN: Record<string, string> = {
  BROUILLON: "Brouillon",
  SOUMIS: "Soumis",
  A_CLARIFIER: "À clarifier",
  VALIDE: "Validé",
  ARCHIVE: "Archivé",
};

const TRENTE_JOURS_MS = 30 * 24 * 60 * 60 * 1000;

export default function ProfilClientPage() {
  const [data, setData] = useState<ProfilData | null>(null);
  const [chargement, setChargement] = useState(true);
  const [onglet, setOnglet] = useState("vue-ensemble");
  const [erreurChargement, setErreurChargement] = useState(false);

  function charger() {
    fetch("/api/client/profil", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setData(d);
        setErreurChargement(false);
      })
      .catch(() => setErreurChargement(true))
      .finally(() => setChargement(false));
  }

  useEffect(() => {
    // LOT 3 : lien direct vers l'onglet entreprise (alertes de complétude).
    if (typeof window !== "undefined" && window.location.hash === "#entreprise") setOnglet("organisation");
    charger();
  }, []);

  if (!chargement && erreurChargement && !data) {
    return (
      <Section title="Profil">
        <Card>
          <p role="alert" style={{ margin: 0, fontSize: 13 }}>
            Impossible de charger votre profil pour le moment. <Bouton variant="secondary" onClick={charger}>Réessayer</Bouton>
          </p>
        </Card>
      </Section>
    );
  }

  if (chargement || !data) {
    return (
      <Section title="Profil">
        <EmptyState message="Chargement…" />
      </Section>
    );
  }

  const aConfirmer = data.faits.filter((f) => f.statut === "INFERE" || f.statut === "OBSERVE");

  const TABS = [
    { id: "vue-ensemble", label: "Vue d'ensemble" },
    { id: "organisation", label: "Mon entreprise", badge: data.completude?.prochaineEtape ? data.completude.etapes.find((e) => !e.complete)!.manquants.length : 0 },
    { id: "contexte-objectifs", label: "Contexte & Objectifs" },
    { id: "contraintes-preferences", label: "Contraintes & Préférences" },
    { id: "besoins-recurrence", label: "Besoins & Récurrence" },
    { id: "resultats", label: "Résultats" },
    { id: "a-confirmer", label: "À confirmer", badge: aConfirmer.length },
  ];

  return (
    <div>
      <Section title="Profil">
        <HeaderProfil data={data} onOngletChange={setOnglet} />
        <Tabs tabs={TABS} actif={onglet} onChange={setOnglet} />

        {onglet === "vue-ensemble" && <VueEnsemble data={data} aConfirmer={aConfirmer} onOngletChange={setOnglet} />}
        {onglet === "organisation" && (
          <>
            <CompletudeEntreprise completude={data.completude} client={data.client} aConfirmer={aConfirmer.length} onOngletChange={setOnglet} />
            <Organisation client={data.client} recharger={charger} />
          </>
        )}
        {onglet === "contexte-objectifs" && (
          <FaitsRepetables
            titre="Contexte & Objectifs"
            cles={["CONTEXTE_ACTIVITE", "ENJEU", "OBJECTIF_DURABLE", "PRIORITE_DURABLE"]}
            faits={data.faits}
            recharger={charger}
          />
        )}
        {onglet === "contraintes-preferences" && (
          <FaitsRepetables
            titre="Contraintes & Préférences"
            cles={["CONTRAINTE_DURABLE", "PREFERENCE_DURABLE", "CRITERE_REUSSITE_DURABLE", "RISQUE_DURABLE"]}
            faits={data.faits}
            recharger={charger}
          />
        )}
        {onglet === "besoins-recurrence" && <BesoinsRecurrence data={data} recharger={charger} />}
        {onglet === "resultats" && <Resultats data={data} recharger={charger} />}
        {onglet === "a-confirmer" && <AConfirmer faits={aConfirmer} recharger={charger} />}
      </Section>
    </div>
  );
}

function HeaderProfil({ data, onOngletChange }: { data: ProfilData; onOngletChange: (id: string) => void }) {
  const dates = [data.profile.updatedAt, ...data.faits.map((f) => f.createdAt)].map((d) => new Date(d).getTime());
  const derniereMaj = dates.length > 0 ? new Date(Math.max(...dates)) : new Date(data.profile.updatedAt);

  return (
    <Card style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
      <div>
        <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: bleuFonce }}>{data.client.nom}</p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: grisTexte }}>
          {[data.client.secteur, data.client.pays].filter(Boolean).join(" · ") || "Secteur et pays non renseignés"}
        </p>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#94a0b3" }}>
          Dernière mise à jour : {derniereMaj.toLocaleDateString("fr-FR")}
        </p>
      </div>
      <Bouton variant="tertiary" onClick={() => onOngletChange("organisation")}>
        Corriger mes informations
      </Bouton>
    </Card>
  );
}

function VueEnsemble({
  data,
  aConfirmer,
  onOngletChange,
}: {
  data: ProfilData;
  aConfirmer: Fait[];
  onOngletChange: (id: string) => void;
}) {
  const contexte = data.faits.find((f) => f.cle === "CONTEXTE_ACTIVITE");
  const objectifs = data.faits.filter((f) => f.cle === "OBJECTIF_DURABLE").slice(0, 2);
  const signauxNonConfirmes = data.signauxRecurrence.slice(0, 2);

  const maintenant = Date.now();
  const recemment = [...data.faits]
    .filter((f) => maintenant - new Date(f.createdAt).getTime() < TRENTE_JOURS_MS)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Card style={{ flex: "1 1 140px" }}>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: bleuFonce }}>{data.resultats.missionsRealisees}</p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: grisTexte }}>Missions réalisées</p>
        </Card>
        {data.resultats.noteMoyenne !== null && (
          <Card style={{ flex: "1 1 140px" }}>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: bleuFonce }}>{data.resultats.noteMoyenne.toFixed(1)} / 5</p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: grisTexte }}>Note moyenne ({data.resultats.nombreEvaluations} évaluation{data.resultats.nombreEvaluations > 1 ? "s" : ""})</p>
          </Card>
        )}
        <Card style={{ flex: "1 1 140px" }}>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: bleuFonce }}>{data.besoins.ouverts}</p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: grisTexte }}>Besoin{data.besoins.ouverts > 1 ? "s" : ""} ouvert{data.besoins.ouverts > 1 ? "s" : ""}</p>
        </Card>
      </div>

      <Card>
        <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 8px" }}>Ce qu&apos;ATLAS comprend</p>
        {contexte ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
            <p style={{ margin: 0, fontSize: 13 }}>{contexte.valeur}</p>
            <Badge variant={VARIANT_PROVENANCE[contexte.statut]}>{LABEL_PROVENANCE[contexte.statut]}</Badge>
          </div>
        ) : (
          <EmptyState message="Aucun contexte d'activité renseigné pour l'instant." />
        )}
        {objectifs.map((o) => (
          <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginTop: 6 }}>
            <p style={{ margin: 0, fontSize: 13 }}>{o.valeur}</p>
            <Badge variant={VARIANT_PROVENANCE[o.statut]}>{LABEL_PROVENANCE[o.statut]}</Badge>
          </div>
        ))}
        {signauxNonConfirmes.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #eee" }}>
            {signauxNonConfirmes.map((s) => (
              <p key={`${s.cle}-${s.valeur}`} style={{ margin: "4px 0", fontSize: 12, color: grisTexte }}>
                &quot;{s.valeur}&quot; apparaît dans {s.occurrences} de vos besoins récents.{" "}
                <button onClick={() => onOngletChange("besoins-recurrence")} style={{ color: bleuFonce, background: "none", border: "none", padding: 0, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
                  Voir
                </button>
              </p>
            ))}
          </div>
        )}
      </Card>

      {recemment.length > 0 && (
        <Card>
          <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 8px" }}>Récemment</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recemment.map((f) => (
              <div key={f.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: grisTexte }}>
                <span>
                  {LABEL_CLE[f.cle] ?? f.cle} : {f.valeur}
                </span>
                <span>{new Date(f.createdAt).toLocaleDateString("fr-FR")}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: 0 }}>À confirmer ({aConfirmer.length})</p>
          {aConfirmer.length > 0 && (
            <button onClick={() => onOngletChange("a-confirmer")} style={{ color: bleuFonce, background: "none", border: "none", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
              Tout voir
            </button>
          )}
        </div>
        {aConfirmer.length === 0 ? (
          <EmptyState message="Rien à confirmer pour l'instant." />
        ) : (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {aConfirmer.slice(0, 3).map((f) => (
              <p key={f.id} style={{ margin: 0, fontSize: 13 }}>
                {LABEL_CLE[f.cle] ?? f.cle} : {f.valeur}
              </p>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

type ChampForm = { cle: keyof Client; label: string; sensible: boolean; type?: "email" | "url" | "tel" | "pays" | "texte-long"; aide?: string };

// LOT 3 (28/10/2026) — profil entreprise regroupé par usage. Les champs
// requis dépendent de l'étape (voir lib/client-profile/completude.ts) : le
// panneau de complétude indique lesquels manquent et pour quoi faire.
const SECTIONS_ENTREPRISE: { titre: string; champs: ChampForm[] }[] = [
  {
    titre: "Identité légale",
    champs: [
      { cle: "nom", label: "Raison sociale", sensible: true },
      { cle: "formeJuridique", label: "Forme juridique", sensible: true, aide: "SAS, SARL, SA, entreprise individuelle…" },
      { cle: "pays", label: "Pays d'immatriculation", sensible: true, type: "pays" },
      { cle: "identifiantEntreprise", label: "Numéro d'immatriculation", sensible: true, aide: "SIREN, RC, RNE… selon votre pays" },
      { cle: "identifiantFiscal", label: "Identifiant fiscal", sensible: true, aide: "TVA intracommunautaire, matricule fiscal… s'il s'applique à votre entreprise" },
      { cle: "secteur", label: "Secteur d'activité", sensible: false },
      { cle: "siteWeb", label: "Site Internet", sensible: false, type: "url" },
    ],
  },
  {
    titre: "Adresses",
    champs: [
      { cle: "adresseSiege", label: "Adresse du siège", sensible: true, type: "texte-long" },
      { cle: "adresseFacturation", label: "Adresse de facturation", sensible: true, type: "texte-long", aide: "Laissez vide si elle est identique à l'adresse du siège" },
    ],
  },
  {
    titre: "Interlocuteur principal",
    champs: [
      { cle: "contactReferent", label: "Nom de l'interlocuteur", sensible: false },
      { cle: "fonctionContact", label: "Fonction", sensible: false },
      { cle: "email", label: "E-mail de contact", sensible: false, type: "email" },
      { cle: "telephone", label: "Téléphone professionnel", sensible: false, type: "tel" },
    ],
  },
  {
    titre: "Facturation",
    champs: [
      { cle: "contactFacturationNom", label: "Contact de facturation", sensible: false, aide: "Si différent de l'interlocuteur principal" },
      { cle: "contactFacturationEmail", label: "E-mail de facturation", sensible: false, type: "email" },
    ],
  },
];

const STYLE_CHAMP = { width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e4e7ee", fontFamily: "inherit", fontSize: 13 } as const;

// LOT 7 / planche (01/11/2026) — « Mon entreprise » : avancement global,
// alerte si le profil est incomplet, informations manquantes avec leur niveau
// (Obligatoire pour une étape, Recommandé, En attente de validation) et
// détail du profil ; puis les exigences par étape (LOT 3).
function CompletudeEntreprise({
  completude,
  client,
  aConfirmer,
  onOngletChange,
}: {
  completude: Completude | undefined;
  client: Client;
  aConfirmer: number;
  onOngletChange: (id: string) => void;
}) {
  if (!completude) return null;
  const obligatoires = completude.manquantes.filter((m) => m.niveau === "OBLIGATOIRE");
  const recommandees = completude.manquantes.filter((m) => m.niveau === "RECOMMANDE");
  const allerAuFormulaire = () => {
    const premier = document.querySelector<HTMLElement>("#formulaire-entreprise input, #formulaire-entreprise select, #formulaire-entreprise textarea");
    document.getElementById("formulaire-entreprise")?.scrollIntoView({ behavior: "smooth", block: "start" });
    premier?.focus({ preventScroll: true });
  };
  const etapeDe = (e: string | null) => (e ? completude.etapes.find((x) => x.etape === e)?.libelle : null);
  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: bleuFonce }}>Complétez votre profil pour accéder à toutes les fonctionnalités</p>
          <span style={{ fontSize: 13, fontWeight: 700, color: bleuFonce }}>{completude.pourcentage} % complété</span>
        </div>
        <div
          role="progressbar"
          aria-label="Avancement du profil entreprise"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completude.pourcentage}
          style={{ height: 8, borderRadius: 999, background: "#e9edf5", marginTop: 10, overflow: "hidden" }}
        >
          <div style={{ width: `${completude.pourcentage}%`, height: "100%", background: completude.pourcentage === 100 ? "#1a7f4b" : "#2557d6" }} />
        </div>
        {obligatoires.length > 0 && (
          <div role="note" style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "#fdf3f2", border: "1px solid #f3c7c1", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13 }}>
              <strong>Profil incomplet.</strong> Certaines informations manquent pour {etapeDe(obligatoires[0].etape)?.toLowerCase() ?? "la suite"}.
            </span>
            <Bouton onClick={allerAuFormulaire}>Compléter mon profil</Bouton>
          </div>
        )}
      </Card>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <Card style={{ flex: "2 1 320px" }}>
          <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 700, color: bleuFonce }}>Informations manquantes</p>
          {completude.manquantes.length === 0 && aConfirmer === 0 && <p style={{ margin: 0, fontSize: 13, color: grisTexte }}>Aucune : votre profil est complet.</p>}
          <ul aria-label="Informations manquantes" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column" }}>
            {obligatoires.map((m) => (
              <li key={m.libelle} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 0", borderTop: "1px solid #eef1f6", fontSize: 13 }}>
                <span>
                  {m.libelle}
                  <span style={{ display: "block", fontSize: 11, color: grisTexte }}>Pour : {etapeDe(m.etape)}</span>
                </span>
                <Badge variant="error">Obligatoire</Badge>
              </li>
            ))}
            {recommandees.map((m) => (
              <li key={m.libelle} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 0", borderTop: "1px solid #eef1f6", fontSize: 13 }}>
                <span>{m.libelle}</span>
                <Badge variant="info">Recommandé</Badge>
              </li>
            ))}
            {aConfirmer > 0 && (
              <li style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 0", borderTop: "1px solid #eef1f6", fontSize: 13 }}>
                <span>
                  {aConfirmer} information{aConfirmer > 1 ? "s" : ""} déduite{aConfirmer > 1 ? "s" : ""} par ATLAS{" "}
                  <button type="button" onClick={() => onOngletChange("a-confirmer")} style={{ border: 0, background: "none", color: "#2557d6", padding: 0, cursor: "pointer", fontSize: 13 }}>
                    à confirmer
                  </button>
                </span>
                <Badge variant="warning">En attente de validation</Badge>
              </li>
            )}
          </ul>
        </Card>
        <Card style={{ flex: "1 1 220px" }}>
          <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 700, color: bleuFonce }}>Détail du profil</p>
          <dl style={{ margin: 0, fontSize: 13, display: "flex", flexDirection: "column", gap: 6 }}>
            {(
              [
                ["Entreprise", client.nom],
                ["Forme juridique", client.formeJuridique],
                ["Pays d'immatriculation", client.pays],
                ["Secteur d'activité", client.secteur],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt style={{ fontSize: 11, color: grisTexte }}>{k}</dt>
                <dd style={{ margin: 0 }}>{v || <em style={{ color: "#9aa3b2" }}>non renseigné</em>}</dd>
              </div>
            ))}
          </dl>
          <button type="button" onClick={allerAuFormulaire} style={{ marginTop: 10, border: 0, background: "none", color: "#2557d6", padding: 0, cursor: "pointer", fontSize: 13 }}>
            Voir tous les détails
          </button>
        </Card>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 700, color: bleuFonce }}>Informations nécessaires selon l&apos;étape</p>
        <p style={{ margin: "0 0 10px", fontSize: 12, color: grisTexte }}>
          Vous n&apos;avez pas à tout remplir dès maintenant : chaque information n&apos;est demandée que pour l&apos;étape qui en a besoin.
          Ces exigences sont celles d&apos;ATLAS pour travailler avec vous, pas des obligations légales.
        </p>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {completude.etapes
            .filter((e) => e.etape !== "COMPTE")
            .map((e) => (
              <li key={e.etape} style={{ fontSize: 13 }}>
                <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Badge variant={e.complete ? "success" : "warning"}>{e.complete ? "Prêt" : "À compléter"}</Badge>
                  <strong>{e.libelle}</strong>
                </span>
                {!e.complete && <span style={{ display: "block", marginTop: 2, color: grisTexte, fontSize: 12 }}>Manquant : {e.manquants.join(", ")}</span>}
              </li>
            ))}
        </ul>
      </Card>
    </>
  );
}

function Organisation({ client, recharger }: { client: Client; recharger: () => void }) {
  const [champs, setChamps] = useState(client);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState(false);
  const TOUS = SECTIONS_ENTREPRISE.flatMap((s) => s.champs);

  async function enregistrer() {
    const modifies = Object.entries(champs).filter(([cle, valeur]) => (client as Record<string, string | null>)[cle] !== valeur);
    if (modifies.length === 0) return;

    const champSensibleModifie = TOUS.find((c) => c.sensible && modifies.some(([cle]) => cle === c.cle));
    if (champSensibleModifie) {
      const confirme = window.confirm(
        "Cette information peut apparaître dans vos futurs documents générés. Les documents déjà générés ne seront pas modifiés. Continuer ?"
      );
      if (!confirme) return;
    }

    setErreur(null);
    setSucces(false);
    setEnvoi(true);
    const reponse = await fetch("/api/client/profil", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(modifies)),
    });
    setEnvoi(false);
    if (!reponse.ok) {
      const d = await reponse.json().catch(() => ({}));
      setErreur(d.error ?? "Une erreur est survenue.");
      return;
    }
    setSucces(true);
    recharger();
  }

  return (
    <Card>
      <form
        id="formulaire-entreprise"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          enregistrer();
        }}
        style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 560 }}
      >
        {SECTIONS_ENTREPRISE.map((section) => (
          <fieldset key={section.titre} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            <legend style={{ fontSize: 14, fontWeight: 700, color: bleuFonce, marginBottom: 8 }}>{section.titre}</legend>
            {section.champs.map((c) => {
              const id = `champ-${c.cle}`;
              const valeur = (champs[c.cle] as string | null) ?? "";
              const majChamp = (v: string) => setChamps({ ...champs, [c.cle]: v });
              return (
                <div key={c.cle} style={{ fontSize: 13 }}>
                  <label htmlFor={id} style={{ display: "block", marginBottom: 4, color: grisTexte }}>{c.label}</label>
                  {c.type === "pays" ? (
                    <select id={id} value={valeur} onChange={(e) => majChamp(e.target.value)} style={STYLE_CHAMP}>
                      <option value="">Choisir…</option>
                      {valeur && !(PAYS as readonly string[]).includes(valeur) && <option value={valeur}>{valeur}</option>}
                      {PAYS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  ) : c.type === "texte-long" ? (
                    <textarea id={id} value={valeur} onChange={(e) => majChamp(e.target.value)} rows={2} style={STYLE_CHAMP} />
                  ) : (
                    <input
                      id={id}
                      type={c.type === "email" ? "email" : c.type === "url" ? "url" : c.type === "tel" ? "tel" : "text"}
                      value={valeur}
                      onChange={(e) => majChamp(e.target.value)}
                      aria-describedby={c.aide ? `${id}-aide` : undefined}
                      style={STYLE_CHAMP}
                    />
                  )}
                  {c.aide && <span id={`${id}-aide`} style={{ display: "block", marginTop: 2, fontSize: 11, color: "#94a0b3" }}>{c.aide}</span>}
                </div>
              );
            })}
          </fieldset>
        ))}
        {erreur && <p role="alert" style={{ color: "#c0392b", fontSize: 13, margin: 0 }}>{erreur}</p>}
        {succes && <p role="status" style={{ color: "#1e7e46", fontSize: 13, margin: 0 }}>Informations enregistrées.</p>}
        <Bouton type="submit" disabled={envoi} style={{ alignSelf: "flex-start" }}>
          {envoi ? "Enregistrement…" : "Enregistrer"}
        </Bouton>
      </form>
    </Card>
  );
}

function FaitsRepetables({ titre, cles, faits, recharger }: { titre: string; cles: string[]; faits: Fait[]; recharger: () => void }) {
  const [ajoutCle, setAjoutCle] = useState<string | null>(null);
  const [valeur, setValeur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function ajouter(cle: string) {
    if (valeur.trim().length === 0) return;
    setErreur(null);
    setEnvoi(true);
    const reponse = await fetch("/api/client/profil/faits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cle, action: "AJOUTER", valeur }),
    });
    setEnvoi(false);
    if (!reponse.ok) {
      const d = await reponse.json().catch(() => ({}));
      setErreur(d.error ?? "Une erreur est survenue.");
      return;
    }
    setValeur("");
    setAjoutCle(null);
    recharger();
  }

  async function confirmer(cle: string, factIdACopier: string) {
    setEnvoi(true);
    await fetch("/api/client/profil/faits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cle, action: "CONFIRMER", factIdACopier }),
    });
    setEnvoi(false);
    recharger();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {cles.map((cle) => {
        const instances = faits.filter((f) => f.cle === cle);
        return (
          <Card key={cle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: bleuFonce }}>{LABEL_CLE[cle] ?? cle}</p>
              {ajoutCle !== cle && (
                <Bouton variant="secondary" onClick={() => { setAjoutCle(cle); setValeur(""); setErreur(null); }} disabled={envoi}>
                  Ajouter
                </Bouton>
              )}
            </div>

            {instances.length === 0 && ajoutCle !== cle && <EmptyState message="Rien de renseigné pour l'instant." />}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {instances.map((f) => (
                <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <span>{f.valeur}</span>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <Badge variant={VARIANT_PROVENANCE[f.statut]}>{LABEL_PROVENANCE[f.statut]}</Badge>
                    {(f.statut === "INFERE" || f.statut === "OBSERVE") && (
                      <Bouton variant="tertiary" onClick={() => confirmer(cle, f.id)} disabled={envoi}>
                        Confirmer
                      </Bouton>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {ajoutCle === cle && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <input
                  value={valeur}
                  onChange={(e) => setValeur(e.target.value)}
                  placeholder="Nouvelle valeur"
                  aria-label={`Nouvelle valeur : ${LABEL_CLE[cle] ?? cle}`}
                  style={{ flex: 1, padding: 6, borderRadius: 6, border: "1px solid #e4e7ee", fontFamily: "inherit", fontSize: 13 }}
                />
                <Bouton onClick={() => ajouter(cle)} disabled={envoi || valeur.trim().length === 0}>
                  Envoyer
                </Bouton>
                <Bouton variant="secondary" onClick={() => setAjoutCle(null)} disabled={envoi}>
                  Annuler
                </Bouton>
              </div>
            )}
            {erreur && ajoutCle === cle && <p style={{ color: "#c0392b", fontSize: 12, margin: "6px 0 0" }}>{erreur}</p>}
          </Card>
        );
      })}
      <p style={{ fontSize: 11, color: "#94a0b3", margin: 0 }}>{titre}</p>
    </div>
  );
}

function BesoinsRecurrence({ data, recharger }: { data: ProfilData; recharger: () => void }) {
  const [envoi, setEnvoi] = useState(false);

  async function enregistrerSignal(signal: SignalRecurrence) {
    setEnvoi(true);
    await fetch("/api/client/profil/faits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cle: "BESOIN_RECURRENT_CONFIRME", action: "AJOUTER", valeur: signal.valeur, depuisSignal: true }),
    });
    setEnvoi(false);
    recharger();
  }

  const besoinsRecurrentsConfirmes = data.faits.filter((f) => f.cle === "BESOIN_RECURRENT_CONFIRME");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 8px" }}>Besoins récents</p>
        {data.besoins.recents.length === 0 ? (
          <EmptyState message="Aucun besoin exprimé pour l'instant." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.besoins.recents.map((b) => (
              <div key={b.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>{b.titre ?? b.texteOriginal.slice(0, 60)}</span>
                <Badge variant="info">{LABEL_STATUT_BESOIN[b.statut] ?? b.statut}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 8px" }}>Signaux de récurrence</p>
        {data.signauxRecurrence.length === 0 ? (
          <EmptyState message="Aucune récurrence détectée pour l'instant." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.signauxRecurrence.map((s) => (
              <div key={`${s.cle}-${s.valeur}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                <span>
                  &quot;{s.valeur}&quot; apparaît dans {s.occurrences} de vos besoins.
                </span>
                <Bouton variant="secondary" onClick={() => enregistrerSignal(s)} disabled={envoi}>
                  Enregistrer dans mon profil
                </Bouton>
              </div>
            ))}
          </div>
        )}
      </Card>

      {besoinsRecurrentsConfirmes.length > 0 && (
        <Card>
          <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 8px" }}>Besoins récurrents confirmés</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {besoinsRecurrentsConfirmes.map((f) => (
              <div key={f.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>{f.valeur}</span>
                <Badge variant={VARIANT_PROVENANCE[f.statut]}>{LABEL_PROVENANCE[f.statut]}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Resultats({ data, recharger }: { data: ProfilData; recharger: () => void }) {
  const [envoi, setEnvoi] = useState(false);
  const dejaConfirme = data.faits.some(
    (f) => f.cle === "CRITERE_REUSSITE_DURABLE" && data.signalResultatMission && normaliserPourComparaison(f.valeur) === normaliserPourComparaison(data.signalResultatMission.valeur)
  );

  async function enregistrerSignalResultat() {
    if (!data.signalResultatMission) return;
    setEnvoi(true);
    await fetch("/api/client/profil/faits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cle: data.signalResultatMission.cle,
        action: "AJOUTER",
        valeur: data.signalResultatMission.valeur,
        depuisSignal: true,
      }),
    });
    setEnvoi(false);
    recharger();
  }

  return (
    <Card>
      <p style={{ fontSize: 11, textTransform: "uppercase", color: "#888", margin: "0 0 8px" }}>Résultats</p>
      <p style={{ margin: 0, fontSize: 13 }}>{data.resultats.missionsRealisees} mission(s) réalisée(s)</p>
      {data.resultats.noteMoyenne !== null && (
        <p style={{ margin: "6px 0 0", fontSize: 13 }}>
          Note moyenne : {data.resultats.noteMoyenne.toFixed(1)} / 5 ({data.resultats.nombreEvaluations} évaluation{data.resultats.nombreEvaluations > 1 ? "s" : ""})
        </p>
      )}
      <p style={{ margin: "10px 0 0", fontSize: 12, color: grisTexte }}>
        Le détail de vos missions et évaluations est disponible dans la rubrique{" "}
        <a href="/client/resultats" style={{ color: bleuFonce }}>Résultats</a>.
      </p>
      {data.signalResultatMission && !dejaConfirme && (
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <p style={{ margin: 0, fontSize: 13 }}>{data.signalResultatMission.valeur}</p>
          <Bouton variant="secondary" onClick={enregistrerSignalResultat} disabled={envoi}>
            Enregistrer dans mon profil
          </Bouton>
        </div>
      )}
    </Card>
  );
}

function normaliserPourComparaison(valeur: string): string {
  return valeur.trim().toLowerCase();
}

function AConfirmer({ faits, recharger }: { faits: Fait[]; recharger: () => void }) {
  const [envoi, setEnvoi] = useState(false);

  async function confirmer(cle: string, factIdACopier: string) {
    setEnvoi(true);
    await fetch("/api/client/profil/faits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cle, action: "CONFIRMER", factIdACopier }),
    });
    setEnvoi(false);
    recharger();
  }

  if (faits.length === 0) {
    return (
      <Card>
        <EmptyState message="Rien à confirmer pour l'instant." />
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {faits.map((f) => (
          <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #eee", paddingBottom: 8 }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{LABEL_CLE[f.cle] ?? f.cle}</p>
              <p style={{ margin: "2px 0 0", fontSize: 13 }}>{f.valeur}</p>
              <Badge variant={VARIANT_PROVENANCE[f.statut]}>{LABEL_PROVENANCE[f.statut]}</Badge>
            </div>
            <Bouton variant="secondary" onClick={() => confirmer(f.cle, f.id)} disabled={envoi}>
              Confirmer
            </Bouton>
          </div>
        ))}
      </div>
    </Card>
  );
}
